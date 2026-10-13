# eQwik YardHRMS™

Multi-tenant HR & Payroll SaaS for Jamaican businesses, with the separate **Qwik Licence & Subscription
Manager** used by Qwik Business Solutions™ staff to run customers, plans, manual payments, subscriptions
and one-time activation codes.

> **Status: pre-release — not production-ready.** The software is functionally complete for the release-1
> scope and passes its automated acceptance suite, but it must not process live payroll or customer data
> until the gates in [Known limitations & open decisions](docs/known-limitations.md) are closed — most
> importantly, the statutory payroll rules must be entered from authoritative sources and signed off by a
> qualified Jamaican payroll specialist. No statutory rates are shipped in the code.

## What is in the box

| Path | What it is |
|---|---|
| `apps/hrms-web` | Tenant-facing React app (employees, leave, timesheets, overtime, payroll, payslips, reports, imports, users/roles, settings, subscription) |
| `apps/license-admin-web` | Qwik platform React app (customers, products, plans, manual payments, subscriptions, licences, activation codes, renewals, usage, platform audit, staff) |
| `apps/api` | NestJS REST API (`/api/v1`, OpenAPI at `/api/docs`) — all business rules, RBAC, entitlements, audit |
| `apps/worker` | Background worker: imports, payslip PDFs, subscription expiry sweep, leave accruals |
| `packages/payroll-engine` | Pure decimal payroll calculation engine (independently tested) |
| `packages/authorization` | Permissions, role templates, features, subscription states |
| `packages/types` | Shared zod schemas/DTOs used by the API and both frontends |
| `packages/ui` | Shared accessible React design system |
| `packages/configuration` | Shared lint/security rules and Tailwind preset |
| `prisma/` | MySQL schema, migrations and integrity triggers |
| `infra/docker` | Dockerfiles, nginx template, compose environment template |
| `tools/legacy-migration` | Legacy Google Sheets → YardHRMS migration CLI |
| `tests/e2e` | Playwright browser journeys |
| `docs/` | Guides (see below) |

Stack: React 19 + TypeScript + Vite + Tailwind + React Router + TanStack Query + React Hook Form + Zod +
Recharts + Lucide · NestJS 11 + Prisma 6 + MySQL 8.4 · Redis (rate limiting) · S3-compatible private
object storage · Argon2id, server-side sessions, TOTP MFA, AES-256-GCM field encryption.

## Quick start (Docker, everything in containers)

```bash
cp infra/docker/compose.env.example infra/docker/compose.env
# fill FIELD_ENCRYPTION_KEY and TOKEN_HMAC_KEY:  openssl rand -base64 32
# set SEED_PLATFORM_ADMIN_EMAIL / SEED_PLATFORM_ADMIN_PASSWORD for the first Qwik super admin
docker compose up -d --build
```

| URL | |
|---|---|
| http://localhost:8080 | eQwik YardHRMS (tenant app) |
| http://localhost:8081 | Qwik Licence & Subscription Manager |
| http://localhost:8080/api/docs | OpenAPI / Swagger UI |
| http://localhost:8025 | Mailpit (captures verification / invite / reset emails) |

The `migrate` container applies migrations and seeds permissions, plans and the platform admin, then
exits; `api`, `worker` and both web containers start after it. MFA enrolment is required at first
sign-in for Qwik staff and for company Admin/Payroll/Finance roles.

## Local development (without Docker for the apps)

Prerequisites: Node.js ≥ 20.11 (22 recommended), pnpm 10, MySQL 8.4 (8.0 works for development), Redis
(optional in development — an in-memory limiter is used if absent).

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL, TEST_DATABASE_URL, FIELD_ENCRYPTION_KEY, TOKEN_HMAC_KEY
                              # optional dev seed: SEED_PLATFORM_ADMIN_*, SEED_DEMO_TENANT=true
# MySQL with binary logging (the 8.4 default) must allow trigger creation by the app user:
#   SET GLOBAL log_bin_trust_function_creators = 1;   (or run mysqld with --log-bin-trust-function-creators=1)
pnpm db:generate && pnpm db:migrate
pnpm build                    # packages, API, worker, migration tool and both web apps
pnpm db:seed                  # permissions, features, plans (+ platform admin / demo data if configured)

pnpm dev:api                  # http://localhost:3000   (RUN_WORKER_IN_API=true runs jobs in-process)
pnpm dev:worker               # or a separate worker process
pnpm dev:hrms                 # http://localhost:5173
pnpm dev:admin                # http://localhost:5174
```

With `SEED_DEMO_TENANT=true` the seed creates two **synthetic** demo companies ("Blue Mountain Traders",
Professional plan, and "Negril Beach Services", Free plan) with clearly labelled *DEMO ONLY — synthetic
rates (NOT statutory)* payroll rules. Demo credentials are printed by the seed. Never enable this in
production (the seed refuses).

## Tests and checks

```bash
pnpm lint --max-warnings 0    # ESLint (typescript-eslint, react-hooks, security rules)
pnpm typecheck                # all workspaces (run `pnpm build` first)
pnpm test:unit                # payroll engine, authorization, types, UI, migration transforms
pnpm test:integration         # API + MySQL: acceptance scenarios AC-01..AC-15 (uses TEST_DATABASE_URL, which is wiped)
pnpm test:e2e                 # Playwright journeys against running apps (E2E_START_SERVERS=true to auto-start)
```

See [docs/testing.md](docs/testing.md) for the acceptance-scenario mapping and the latest results.

## Documentation

- [Implementation plan & PRD traceability](docs/implementation-plan.md)
- [Production deployment guide](docs/deployment.md) · [Backup & restore](docs/backup-restore.md)
- [Security notes](docs/security.md)
- [Company administrator guide](docs/admin-guide.md)
- [Payroll configuration & calculation policy](docs/PAYROLL_CALCULATION_POLICY.md)
- [Subscription administration guide (Licence Manager)](docs/subscription-admin.md)
- [Legacy migration runbook](tools/legacy-migration/README.md)
- [Testing](docs/testing.md)
- [Known limitations & open owner decisions](docs/known-limitations.md)

## Legal

© 2026 Qwik Business Solutions™. All rights reserved. eQwik YardHRMS™ and Qwik Business Solutions™ are
product and company marks. Statutory payroll output is not certified until the compliance gate described
in the payroll policy is completed (`PAYROLL_COMPLIANCE_CERTIFIED=false`).
