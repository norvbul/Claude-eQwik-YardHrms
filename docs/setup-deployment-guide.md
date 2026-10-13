# Setup & deployment guide

How to install, configure, run, upgrade and look after **eQwik YardHRMS™** and the **Qwik Licence &
Subscription Manager** — from a developer laptop to a production environment.

> **Pre-release.** The software must not process live payroll or customer data until every gate in
> [Known limitations](known-limitations.md#release-gates-must-be-closed-before-live-customer-data) is
> closed: payroll specialist sign-off of the statutory reference packs, legal review of the draft texts,
> an independent penetration test, a backup-restore drill and the operational items in §9 below. Keep
> `PAYROLL_COMPLIANCE_CERTIFIED=false` until then.

Contents

1. [What you are deploying](#1-what-you-are-deploying)
2. [Option A — try it with Docker Compose](#2-option-a--try-it-with-docker-compose)
3. [Option B — local development](#3-option-b--local-development)
4. [Configuration reference](#4-configuration-reference)
5. [Production deployment](#5-production-deployment)
6. [First-day setup after deployment](#6-first-day-setup-after-deployment)
7. [Single sign-on (Google / Microsoft)](#7-single-sign-on-google--microsoft)
8. [Operations: upgrades, backups, monitoring](#8-operations-upgrades-backups-monitoring)
9. [Go-live checklist](#9-go-live-checklist)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. What you are deploying

| Component | Image / workspace | Purpose |
|---|---|---|
| HRMS web | `apps/hrms-web` (nginx) | The company-facing app: employees, leave, time, payroll, payslips, settings |
| Licence Manager web | `apps/license-admin-web` (nginx) | Qwik staff app: customers, plans, manual payments, subscriptions, codes, invoices |
| API | `apps/api` (NestJS) | All business rules, RBAC, audit; REST under `/api/v1`, OpenAPI at `/api/docs` |
| Worker | `apps/worker` | Background jobs: imports, payslip PDFs, emails, accruals, subscription sweep, retention |
| Migrate | `prisma/` | One-shot container: applies migrations and (optionally) seeds reference data |

Backing services: **MySQL 8.4** (system of record; integrity triggers), **Redis 7** (rate limiting),
**S3-compatible private bucket** (payslips, documents, evidence, exports), **SMTP relay** (email).

```
            Internet (HTTPS only)
                   │
      TLS-terminating load balancer / reverse proxy
        ├── app.<domain>      → hrms-web  (static app + /api proxy)
        └── admin.<domain>    → license-admin-web (static app + /api proxy)
                                     │
                       api (2+ replicas, stateless) ── worker (1+ replicas)
                                     │                     │
         MySQL 8.4 (private) · Redis (private) · S3 bucket (private) · SMTP relay
```

![Production topology](images/s01-architecture.png)

Each web container proxies `/api` to the API so session cookies stay first-party on its own host name.

---

## 2. Option A — try it with Docker Compose

Everything runs in containers, including MySQL, Redis, a local S3 server (SeaweedFS) and Mailpit to
catch outgoing email. Good for evaluation, demos and smoke tests. **Not a production setup.**

**Prerequisites:** Docker Engine 24+ with the Compose plugin, ~4 GB free RAM, ports 8080, 8081 and 8025
free, `openssl`.

```bash
git clone <repository-url> yardhrms && cd yardhrms
cp infra/docker/compose.env.example infra/docker/compose.env
```

Edit `infra/docker/compose.env`:

```bash
FIELD_ENCRYPTION_KEY=<output of: openssl rand -base64 32>
TOKEN_HMAC_KEY=<output of: openssl rand -base64 32>
SEED_PLATFORM_ADMIN_EMAIL=you@example.com          # first Qwik super admin
SEED_PLATFORM_ADMIN_PASSWORD=<a strong password>
SEED_DEMO_TENANT=true                              # optional: synthetic demo companies
```

Start the stack:

```bash
docker compose up -d --build
docker compose ps            # wait until api, worker and both web apps are healthy
docker compose logs migrate  # shows migrations, seed output and demo credentials
```

| URL | What |
|---|---|
| http://localhost:8080 | eQwik YardHRMS (company app) |
| http://localhost:8081 | Qwik Licence & Subscription Manager |
| http://localhost:8080/api/docs | OpenAPI / Swagger UI |
| http://localhost:8025 | Mailpit — verification, invitation, reset and notification emails |

![OpenAPI / Swagger UI at /api/docs](images/s02-api-docs.png)

*The interactive API reference at `/api/docs`.*

The `migrate` service runs once (migrations + seed) and exits; this is expected. MySQL is started with
`--log-bin-trust-function-creators=1` so the migration can create triggers.

**Demo data** (`SEED_DEMO_TENANT=true`, development only — the seed refuses it in production):

| Company | Plan | Sign-in |
|---|---|---|
| Blue Mountain Traders | Professional | `admin@`, `hr@`, `payroll@`, `finance@`, `manager@`, `employee@bluemountain.demo` |
| Negril Beach Services | Free | `owner@negrilbeach.demo` |

The demo password and the TOTP secret for the MFA-enrolled demo users are printed in the `migrate`
logs. Demo payroll rules are labelled *DEMO ONLY — synthetic rates (NOT statutory)*.

**Smoke test the stack** by registering a company at http://localhost:8080 → *Start Free*, opening the
verification email in Mailpit, signing in and enrolling MFA:

| Register | MFA enrolment at first sign-in |
|---|---|
| ![Registration form](images/s07-register.png) | ![MFA enrolment](images/s08-mfa-setup.png) |

Stop with `docker compose down`; add `-v` to delete all data volumes and start fresh.

---

## 3. Option B — local development

**Prerequisites:** Node.js ≥ 20.11 (22 recommended), pnpm 10 (`corepack enable`), MySQL 8.4 (8.0 works
for development), Redis 7 (optional — an in-memory limiter is used if absent), and optionally Mailpit for
email.

```bash
pnpm install
cp .env.example .env
```

Set at least these in `.env`:

| Variable | Example |
|---|---|
| `DATABASE_URL` | `mysql://yardhrms:secret@localhost:3306/yardhrms` |
| `TEST_DATABASE_URL` | `mysql://yardhrms:secret@localhost:3306/yardhrms_test` (name must contain `test`; it is wiped by integration tests) |
| `FIELD_ENCRYPTION_KEY`, `TOKEN_HMAC_KEY` | `openssl rand -base64 32` each |
| `SEED_PLATFORM_ADMIN_EMAIL` / `_PASSWORD` | Your first Qwik super admin (dev) |
| `SEED_DEMO_TENANT` | `true` for demo companies |

Prepare MySQL (once, as an administrative user):

```sql
CREATE DATABASE yardhrms CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE yardhrms_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'yardhrms'@'localhost' IDENTIFIED BY 'secret';
GRANT ALL ON yardhrms.* TO 'yardhrms'@'localhost';
GRANT ALL ON yardhrms_test.* TO 'yardhrms'@'localhost';
SET GLOBAL log_bin_trust_function_creators = 1;   -- required for the integrity triggers
```

Build, migrate and seed:

```bash
pnpm db:generate && pnpm db:migrate
pnpm build          # packages, API, worker, migration tool, both web apps
pnpm db:seed        # permissions, features, plans (+ platform admin / demo data)
```

Run (separate terminals):

```bash
RUN_WORKER_IN_API=true pnpm dev:api   # http://localhost:3000  (/api/docs)
pnpm dev:hrms                         # http://localhost:5173
pnpm dev:admin                        # http://localhost:5174
# or run the worker separately instead of RUN_WORKER_IN_API: pnpm dev:worker
```

With `STORAGE_DRIVER=local` files go to `STORAGE_LOCAL_DIR`; with no `SMTP_HOST`, emails are logged to the
API console instead of sent.

**Checks and tests**

```bash
pnpm lint --max-warnings 0
pnpm typecheck                 # after pnpm build
pnpm test:unit
pnpm test:integration          # uses and WIPES TEST_DATABASE_URL
E2E_START_SERVERS=true pnpm test:e2e   # needs the seeded dev database
```

See [testing](testing.md) for the acceptance-scenario mapping.

---

## 4. Configuration reference

All settings are environment variables validated at start-up — the process **refuses to start** on an
invalid configuration. Templates: `.env.example` (local) and `infra/docker/compose.env.example` (Docker).
Never commit filled-in files; in production keep secrets in a secrets manager.

### Core

| Variable | Default / example | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` enforces the safety checks below |
| `API_PORT` | `3000` | |
| `API_PUBLIC_URL`, `HRMS_WEB_URL`, `ADMIN_WEB_URL` | `http://localhost:…` | Public URLs used in email links and SSO redirects |
| `CORS_ORIGINS` | both app origins | Comma-separated; exactly the two app origins in production |
| `TRUST_PROXY` | `false` | `true` behind one proxy hop (correct client IPs for rate limits and audit) |
| `DATABASE_URL` | `mysql://…` | Add `?sslaccept=strict` for TLS in production |
| `TEST_DATABASE_URL` | `mysql://…/yardhrms_test` | Tests only; must contain `test` |
| `REDIS_URL` | `redis://localhost:6379` | `rediss://` in production |

### Security

| Variable | Notes |
|---|---|
| `FIELD_ENCRYPTION_KEY` | 32 random bytes, base64. Encrypts TRN/NIS/NHT, bank accounts and MFA secrets. **Losing it makes that data unrecoverable — back it up.** |
| `TOKEN_HMAC_KEY` | 32 random bytes, base64. Hashes sessions, activation codes and email tokens. Rotating it signs everyone out and voids unredeemed codes and invitations. |
| `COOKIE_SECURE` | `true` in production (**required**) |
| `SESSION_TTL_HOURS`, `SESSION_IDLE_MINUTES` | Absolute / idle session limits (defaults 12 h / 30 min) |
| `MFA_ENFORCEMENT` | `required` in production (**required**): Qwik staff and company Admin/Payroll/Finance roles must use TOTP |
| `MFA_ISSUER` | Name shown in authenticator apps |
| `MAX_UPLOAD_MB` | Upload limit (default 10) |

### Storage and email

| Variable | Notes |
|---|---|
| `STORAGE_DRIVER` | `local` (dev only) or `s3` (**required** in production) |
| `STORAGE_LOCAL_DIR` | Folder for `local` driver |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Private bucket; leave `S3_ENDPOINT` empty for AWS S3 |
| `S3_SERVER_SIDE_ENCRYPTION` | `AES256` or `aws:kms` in production; `none` for the local SeaweedFS |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Authenticated relay with SPF/DKIM/DMARC (`SMTP_HOST` **required** in production) |

### Business settings

| Variable | Notes |
|---|---|
| `PAYROLL_COMPLIANCE_CERTIFIED` | `false` until the payroll compliance gate is passed; while false every run and payslip is marked *Not certified for live payroll* |
| `PAYMENT_REQUIRE_SEPARATE_VERIFIER` | `true`: the person who records a manual payment cannot verify it |
| `BILLING_SELLER_NAME`, `BILLING_SELLER_ADDRESS`, `BILLING_SELLER_EMAIL`, `BILLING_SELLER_TRN` | Qwik's details printed on invoices, receipts and statements |
| `BILLING_GCT_NUMBER`, `BILLING_GCT_RATE` | GCT is added only when the rate is set (Qwik must be GCT-registered); default `0` |
| `BILLING_PAYMENT_INSTRUCTIONS` | Bank-transfer instructions printed on invoices |
| `BILLING_INVOICE_DUE_DAYS` | Default `14` |

### Worker and seeding

| Variable | Notes |
|---|---|
| `RUN_WORKER_IN_API` | `true` only in development; production runs the worker separately |
| `WORKER_ID`, `WORKER_POLL_MS` | Unique ID per worker replica; poll interval |
| `RUN_SEED` | Docker `migrate` container: run the seed after migrations |
| `SEED_PLATFORM_ADMIN_EMAIL`, `SEED_PLATFORM_ADMIN_PASSWORD` | First Qwik super admin; **first deployment only, then remove** |
| `SEED_DEMO_TENANT` | `false` in production (refused anyway) |

### Single sign-on (optional)

| Variable | Notes |
|---|---|
| `OIDC_GOOGLE_CLIENT_ID`, `OIDC_GOOGLE_CLIENT_SECRET` | Enables *Continue with Google* |
| `OIDC_MICROSOFT_CLIENT_ID`, `OIDC_MICROSOFT_CLIENT_SECRET` | Enables *Continue with Microsoft* |
| `OIDC_MICROSOFT_TENANT` | `organizations` (work/school accounts, default), `common`, or a tenant ID |

**Production refuses to start** if `STORAGE_DRIVER` is not `s3`, `SMTP_HOST` is missing, `COOKIE_SECURE`
is false, `MFA_ENFORCEMENT` is not `required`, or rate limiting is disabled.

---

## 5. Production deployment

The steps are provider-neutral; hosting provider, region and data residency are owner decisions.
Run separate **development, staging and production** environments, each with its own database, bucket,
keys and SMTP credentials. Releases go to staging first.

### 5.1 Infrastructure

**MySQL 8.4 LTS** (managed service recommended)

- InnoDB, `character_set_server=utf8mb4`, `collation_server=utf8mb4_0900_ai_ci`, time zone UTC.
- **`log_bin_trust_function_creators=1`** in the parameter group — otherwise the trigger migration fails
  with error 1419.
- Encryption at rest, daily automated backups and point-in-time recovery.
- An application user with rights on the application schema only. Optionally a separate, more
  privileged migration user, with the runtime user limited to SELECT/INSERT/UPDATE/DELETE.

**Redis 7** — private network, password/TLS.

**Object storage** — private bucket (block all public access), versioning on, server-side encryption,
lifecycle rules aligned with the retention policy, credentials scoped to that bucket.

**SMTP** — authenticated relay; SPF, DKIM and DMARC for the sending domain.

**Load balancer** — TLS for `app.<domain>` and `admin.<domain>`, HSTS, HTTP→HTTPS redirect. Restrict
`admin.<domain>` (VPN or IP allow-list) where possible.

### 5.2 Build images

```bash
V=$(git rev-parse --short HEAD)
docker build -f infra/docker/node.Dockerfile --target api     -t <registry>/yardhrms-api:$V .
docker build -f infra/docker/node.Dockerfile --target worker  -t <registry>/yardhrms-worker:$V .
docker build -f infra/docker/node.Dockerfile --target migrate -t <registry>/yardhrms-migrate:$V .
docker build -f infra/docker/web.Dockerfile --build-arg APP=hrms-web          -t <registry>/yardhrms-hrms-web:$V .
docker build -f infra/docker/web.Dockerfile --build-arg APP=license-admin-web -t <registry>/yardhrms-admin-web:$V .
docker push <registry>/yardhrms-{api,worker,migrate,hrms-web,admin-web}:$V
```

Use immutable tags (git SHA), never `latest`. Images run as non-root; the API image health-checks
`GET /api/v1/health` (includes database connectivity). The web images send CSP, frame-deny, nosniff and
referrer-policy headers and ship no source maps.

### 5.3 First deployment

1. Put every variable from §4 in the secrets manager / deployment configuration with production values
   (`NODE_ENV=production`, `COOKIE_SECURE=true`, `MFA_ENFORCEMENT=required`, `STORAGE_DRIVER=s3`,
   `TRUST_PROXY=true`, `RUN_WORKER_IN_API=false`, `PAYROLL_COMPLIANCE_CERTIFIED=false`).
2. Run the **migrate** image once with `RUN_SEED=true` and the `SEED_PLATFORM_ADMIN_*` variables. It
   applies all migrations and seeds permissions, features, plans and the first Qwik super admin.
3. **Remove** `SEED_PLATFORM_ADMIN_PASSWORD` from the configuration.
4. Start the **API** (2+ replicas behind the load balancer target), then the **worker** (1+ replicas,
   unique `WORKER_ID` each), then the two **web** images.
5. Smoke test: `https://app.<domain>/api/v1/health` returns OK; sign in to both apps with MFA; register a
   test company, receive the verification email; upload a company logo (proves storage access).

### 5.4 Releasing an update

1. CI green for the commit (lint, typecheck, unit, integration, e2e, image builds).
2. Take an on-demand database snapshot.
3. Run the new **migrate** image (`prisma migrate deploy`; forward-only migrations, `RUN_SEED` not needed
   unless release notes say so).
4. Roll the API, then the worker, then the web images.
5. Smoke test as above; confirm `background_jobs` has no stuck `RUNNING` rows.

**Rollback:** redeploy the previous image tags. Migrations in this release are additive; if one must be
undone, restore the pre-release snapshot or ship a forward fix. Never edit payroll or audit tables by
hand — database triggers block it by design.

---

## 6. First-day setup after deployment

**Qwik staff (Licence Manager, `admin.<domain>`)**

1. Sign in with the seeded super admin and enrol MFA.
2. *Settings* → add named staff (Super Admins and Licensing Officers). Each receives a password-setup
   link and enrols MFA. Keep at least two Super Admins; do not share accounts.
3. *Plans & Features* → confirm limits, features, grace days and prices (seed prices are a
   **proposal**; see [pricing](pricing.md)).
4. Check the `BILLING_*` details by issuing a test invoice and opening its PDF; void it afterwards.

![Licence Manager staff sign-in](images/s04-licence-sign-in.png)

*Staff sign-in to the Licence Manager. Multi-factor authentication is mandatory.*

![Licence Manager settings: platform policy, staff and MFA reset](images/s05-licence-staff.png)

*Settings shows the effective platform policy (payment controls, MFA, compliance flag, session timeout) — a quick way to confirm the production configuration — plus staff management.*

**Each company (HRMS, `app.<domain>`)** registers itself for the Free plan, or Qwik records a verified
payment and activates a paid plan. The company administrator then follows the
[user manual](user-manual.md) §3 "First-time company setup".

---

## 7. Single sign-on (Google / Microsoft)

Sign-in buttons appear only for providers whose client ID and secret are set. SSO never creates
accounts: users must already be registered or invited. MFA is still required for privileged roles.

![Sign-in page with Google and Microsoft enabled](images/s06-sign-in-sso.png)

*The sign-in page once both providers are configured.*

**Google** (Google Cloud Console → APIs & Services → Credentials → *OAuth client ID*, type *Web
application*)

- Authorised redirect URI: `https://app.<domain>/api/v1/auth/sso/google/callback`
- Scopes: `openid email profile`. Configure the consent screen with your product name and privacy URL.
- Set `OIDC_GOOGLE_CLIENT_ID` and `OIDC_GOOGLE_CLIENT_SECRET`.

**Microsoft** (Microsoft Entra admin centre → App registrations → *New registration*)

- Supported account types: *Accounts in any organizational directory* (matches
  `OIDC_MICROSOFT_TENANT=organizations`).
- Redirect URI (Web): `https://app.<domain>/api/v1/auth/sso/microsoft/callback`
- *Certificates & secrets* → new client secret (note its expiry and diarise rotation).
- *Token configuration* → add the optional ID-token claim **`xms_edov`** (email domain owner verified);
  without it, users link Microsoft from *Account & security* after a password sign-in instead of being
  matched automatically.
- Set `OIDC_MICROSOFT_CLIENT_ID`, `OIDC_MICROSOFT_CLIENT_SECRET`, `OIDC_MICROSOFT_TENANT`.

For local testing use `http://localhost:5173/api/v1/auth/sso/<provider>/callback` (development only).

---

## 8. Operations: upgrades, backups, monitoring

**Backups** — see [backup & restore](backup-restore.md). In short: managed MySQL snapshots + PITR (plus a
snapshot before each release), bucket versioning and replication, and the two keys in a secrets manager
with its own backup. Run a **restore test every quarter**.

**Background jobs** — the worker runs imports, payslip PDFs and email delivery continuously, the
subscription sweep every 15 minutes, and daily leave accruals, renewal reminders and **retention**
(`retention.daily`: purges, anonymisation, executing approved account closures). Check `retention_runs`
and the `retention.*` audit events after the first runs.

**Monitoring and alerts**

- Ship API and worker stdout logs to a central store.
- Alert on: health-check failures, 5xx rate, `background_jobs.status='FAILED'`,
  `outbound_emails.status='FAILED'`, growth of `system_errors`, database CPU/storage, certificate
  expiry, SSO client-secret expiry.
- Track availability (target 99.9 %) and P95 read latency (< 500 ms); load-test before launch.

**Key rotation** — `TOKEN_HMAC_KEY` can be rotated (everyone is signed out; unredeemed codes and pending
invitations become invalid — reissue them). `FIELD_ENCRYPTION_KEY` must **not** be changed in place;
rotating it requires a planned re-encryption migration.

**Legacy customers** — migrate from the Apps Script edition with the
[legacy migration runbook](../tools/legacy-migration/README.md) and reconcile before cut-over.

---

## 9. Go-live checklist

- [ ] Owner decisions recorded ([known limitations](known-limitations.md)): hosting/region, retention,
      pricing, payment controls, legal texts, privacy notice.
- [ ] Payroll compliance gate passed ([policy](PAYROLL_CALCULATION_POLICY.md) §7) by a qualified
      Jamaican payroll specialist **before** `PAYROLL_COMPLIANCE_CERTIFIED=true`.
- [ ] Draft legal texts (terms, privacy, licence, disclaimer) reviewed by counsel.
- [ ] TLS everywhere, HSTS, admin host restricted.
- [ ] Encryption at rest for database and bucket; backups + PITR on; **restore test performed**.
- [ ] Secrets in a secrets manager; keys backed up; seed password removed; demo data disabled.
- [ ] Independent penetration test completed and findings closed.
- [ ] Malware scanning for uploads in place (not built in).
- [ ] Monitoring, alerting and on-call in place; incident and breach-notification procedure agreed.
- [ ] Legacy customers migrated and reconciled.

---

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Migration fails with **error 1419** (*You do not have the SUPER privilege and binary logging is enabled*) | Set `log_bin_trust_function_creators=1` (parameter group, `SET GLOBAL`, or mysqld flag) and re-run the migration |
| API exits at start-up with a configuration error | The message names the invalid variable. In production check the refusals in §4 (S3, SMTP, secure cookies, MFA) |
| Integration tests refuse to run | `TEST_DATABASE_URL` missing or its database name does not contain `test` |
| `pnpm typecheck` fails in worker / migration tool | Run `pnpm build` first; they compile against the API build |
| No emails arrive | Docker: open Mailpit on :8025. Local without `SMTP_HOST`: emails are printed in the API log. Production: check `outbound_emails` for `FAILED` rows and relay credentials/SPF/DKIM |
| Notifications, payslip PDFs or imports never complete | The worker is not running (or `RUN_WORKER_IN_API` is off in dev). Check `background_jobs` for `PENDING`/`FAILED` rows and the worker log |
| Payslip or document downloads show garbage or fail with SeaweedFS | Use `S3_SERVER_SIDE_ENCRYPTION=none` for the local SeaweedFS server |
| Signed out immediately / "invalid CSRF token" behind a proxy | `COOKIE_SECURE=true` needs HTTPS end-to-end at the browser; set `TRUST_PROXY=true`; make sure both app hosts proxy `/api` to the API rather than calling it cross-origin |
| Everyone is rate-limited from one IP | `TRUST_PROXY` not set behind the load balancer, so all requests appear to come from the proxy |
| "Continue with Google/Microsoft" button missing | Client ID/secret not set for that provider (restart the API after setting) |
| SSO returns *no account* | SSO does not create accounts — register or invite the user first. For Microsoft without `xms_edov`, link from *Account & security* |
| Payroll *Prepare* refused: no approved statutory version | A statutory rule version must be imported/entered, verified and **approved by a different user**, and be effective for the period |
| A company cannot add employees | Plan limit reached, or the subscription is in GRACE/EXPIRED/SUSPENDED (read-only). See the Licence Manager *Subscriptions* page |
| Lost `FIELD_ENCRYPTION_KEY` | Encrypted identifiers, bank accounts and MFA secrets cannot be recovered. Restore the key from the secrets-manager backup |
