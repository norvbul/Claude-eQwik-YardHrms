# Production deployment guide

This guide describes a production-grade deployment. Hosting provider, region and data-residency are
open owner decisions (see [known limitations](known-limitations.md)); the steps below are provider
neutral. Do not put customer data on an environment until every item in §8 is complete.

## 1. Topology

```
            Internet (HTTPS only)
                   │
      TLS-terminating load balancer / reverse proxy
        ├── app.<domain>      → hrms-web (nginx: static app + /api proxy)
        └── admin.<domain>    → license-admin-web (nginx: static app + /api proxy)
                                     │
                       api (2+ replicas, stateless)  ── worker (1+ replicas)
                                     │                     │
         MySQL 8.4 (managed, private) · Redis (private) · S3-compatible bucket (private) · SMTP relay
```

- Serve the two apps on **separate host names**. Each nginx container proxies `/api` to the API so
  session cookies stay first-party. Restrict `admin.<domain>` further (VPN / IP allow-list) if possible.
- The API and worker are stateless; scale the API horizontally. The job queue uses
  `SELECT … FOR UPDATE SKIP LOCKED`, so several workers can run safely (give each a unique `WORKER_ID`).
- Keep MySQL, Redis and the bucket on private networks. Nothing but the load balancer is public.

Separate **development, staging and production** environments, each with its own database, bucket,
keys and SMTP credentials (NFR-010). Staging should mirror production and receive releases first.

## 2. Build and publish images

```bash
docker build -f infra/docker/node.Dockerfile --target api      -t <registry>/yardhrms-api:<version> .
docker build -f infra/docker/node.Dockerfile --target worker   -t <registry>/yardhrms-worker:<version> .
docker build -f infra/docker/node.Dockerfile --target migrate  -t <registry>/yardhrms-migrate:<version> .
docker build -f infra/docker/web.Dockerfile --build-arg APP=hrms-web          -t <registry>/yardhrms-hrms-web:<version> .
docker build -f infra/docker/web.Dockerfile --build-arg APP=license-admin-web -t <registry>/yardhrms-admin-web:<version> .
```

Tag immutable versions (git SHA) — never deploy `latest`. Images run as a non-root user; the API image
has a health check on `GET /api/v1/health` (checks database connectivity). The web images set CSP,
frame-deny, nosniff and referrer headers and ship no source maps.

## 3. Infrastructure prerequisites

**MySQL 8.4 LTS** (managed service recommended)

- InnoDB, `character_set_server=utf8mb4`, `collation_server=utf8mb4_0900_ai_ci`, time zone UTC.
- Binary logging is on by default; the migrations create integrity **triggers**, which a non-SUPER user
  can only do with **`log_bin_trust_function_creators=1`** (set it in the managed service's parameter
  group). Without it the second migration fails with error 1419.
- Encryption at rest, automated daily backups and point-in-time recovery enabled (see
  [backup-restore](backup-restore.md)).
- Application user with privileges on the application schema only (SELECT, INSERT, UPDATE, DELETE,
  CREATE, ALTER, INDEX, REFERENCES, TRIGGER, DROP for migrations). Optionally run migrations with a
  separate, more privileged user and give the runtime user DML only.

**Redis 7** — private, password/TLS as offered by the provider. Used for rate limiting across replicas.

**Object storage** — S3-compatible bucket, **private** (block all public access), versioning on,
server-side encryption (`S3_SERVER_SIDE_ENCRYPTION=AES256` or `aws:kms`), lifecycle rules per the
approved retention policy. Credentials scoped to that bucket only.

**SMTP** — authenticated relay with SPF/DKIM/DMARC for the sending domain.

## 4. Configuration and secrets

All settings are environment variables, validated at start-up (the process refuses to start on invalid
config). Keep secrets in the platform's **secrets manager**, never in images, compose files or git.

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` (enforces the checks below) |
| `API_PUBLIC_URL`, `HRMS_WEB_URL`, `ADMIN_WEB_URL` | Public HTTPS URLs (used in email links) |
| `CORS_ORIGINS` | Exactly the two app origins |
| `TRUST_PROXY` | `true` behind one proxy hop (correct client IPs for rate limits and audit) |
| `COOKIE_SECURE` | `true` (**required**) |
| `DATABASE_URL` | `mysql://user:pass@host:3306/yardhrms?sslaccept=strict` |
| `REDIS_URL` | `rediss://…` |
| `FIELD_ENCRYPTION_KEY` | 32 random bytes, base64 — encrypts TRN/NIS/NHT, bank accounts, MFA secrets. **Losing it makes that data unrecoverable; back it up in the secrets manager.** |
| `TOKEN_HMAC_KEY` | 32 random bytes, base64 — hashes session tokens, activation codes, email tokens. Rotating it signs everyone out and invalidates unredeemed codes and pending invitations. |
| `MFA_ENFORCEMENT` | `required` (**required**) |
| `STORAGE_DRIVER` | `s3` (**required**) with `S3_*` settings |
| `SMTP_HOST` … `SMTP_FROM` | Relay settings (`SMTP_HOST` **required**) |
| `SESSION_TTL_HOURS`, `SESSION_IDLE_MINUTES` | Absolute and idle session limits (defaults 12 h / 30 min) |
| `MAX_UPLOAD_MB` | Upload limit (default 10) |
| `PAYROLL_COMPLIANCE_CERTIFIED` | `false` until the payroll compliance gate is passed |
| `PAYMENT_REQUIRE_SEPARATE_VERIFIER` | `true` unless the owner decides otherwise |
| `RUN_WORKER_IN_API` | `false` (run the worker as its own deployment) |
| `WORKER_ID`, `WORKER_POLL_MS` | Per worker replica |
| `SEED_PLATFORM_ADMIN_EMAIL` / `_PASSWORD` | First deployment only, then remove |
| `SEED_DEMO_TENANT` | `false` (the seed refuses demo data in production) |

Generate keys with `openssl rand -base64 32`.

## 5. Release procedure

1. CI must be green for the commit (lint, typecheck, unit, integration, e2e, image builds).
2. Take an on-demand database snapshot (in addition to PITR).
3. Run the **migrate** image once: `prisma migrate deploy` (forward-only, reviewed SQL in
   `prisma/migrations`). On the very first deployment set `RUN_SEED=true` with the seed admin variables
   to create permissions, plans and the first Qwik super admin; remove the seed password afterwards.
4. Roll the API (health-checked), then the worker, then the web images.
5. Smoke test: health endpoint, sign-in on both apps (MFA), open a payslip, check the worker is
   processing (`background_jobs` has no stuck `RUNNING` rows).

**Rollback:** redeploy the previous image tags. Migrations are additive in this release; if a migration
must be undone, restore the pre-release snapshot (and accept data loss since the snapshot) or ship a
forward fix — never edit the payroll/audit tables by hand (triggers prevent it by design).

## 6. First-day administration

1. Sign in to the Licence Manager with the seeded super admin and enrol MFA.
2. Create named staff accounts (super admins, licensing officers); disable shared accounts.
3. Review plans (limits, features, grace). **Prices are blank by design** until the owner sets them.
4. Companies self-register for Free, or Qwik records a verified payment and activates a paid plan.

## 7. Observability

- API and worker log to stdout (Nest logger) — ship to a central log store with retention.
- Alert on: health check failures, 5xx rate, failed jobs (`background_jobs.status='FAILED'`), outbound
  email failures (`outbound_emails.status='FAILED'`), `system_errors` growth, database CPU/storage,
  replication lag, certificate expiry.
- Track the 99.9% availability and P95 < 500 ms read-latency targets (NFR-002/003) with uptime checks
  and APM; run a load test before launch.

## 8. Go-live checklist

- [ ] Owner decisions in [known limitations](known-limitations.md) recorded (hosting/region, retention,
      pricing, payment controls, legal text, privacy notice).
- [ ] TLS everywhere; HSTS at the load balancer; admin host restricted.
- [ ] Database and bucket encryption at rest; backups + PITR enabled; **restore test performed**.
- [ ] Secrets in a secrets manager; keys backed up; seed password removed.
- [ ] Independent penetration test (OWASP: injection, XSS, CSRF, IDOR, SSRF, access control, uploads,
      session fixation, rate-limit bypass) with findings closed.
- [ ] Malware scanning for uploads in place (not built in — see limitations).
- [ ] Payroll compliance gate passed ([policy](PAYROLL_CALCULATION_POLICY.md) §7) before setting
      `PAYROLL_COMPLIANCE_CERTIFIED=true`.
- [ ] Monitoring and on-call in place; incident and breach-notification procedure agreed.
- [ ] Legacy customers migrated and reconciled ([runbook](../tools/legacy-migration/README.md)).
