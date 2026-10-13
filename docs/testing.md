# Testing

## Suites

| Command | What | Needs |
|---|---|---|
| `pnpm lint --max-warnings 0` | ESLint (typescript-eslint, react-hooks, no raw HTML, no eval) | — |
| `pnpm typecheck` | Every workspace (`pnpm build` first: worker and migration tool compile against the API build) | — |
| `pnpm test:unit` | Payroll engine, authorization, shared schemas, UI kit, API security helpers, web pages, migration transforms | — |
| `pnpm test:integration` | NestJS app + real MySQL: acceptance scenarios AC-01..AC-15 and security cases | `TEST_DATABASE_URL` (database name must contain `test`; **all tables are dropped** and migrations re-applied) |
| `pnpm test:e2e` | Playwright: real browser against both React apps, API and MySQL | Seeded dev database (`SEED_DEMO_TENANT=true`, platform admin); `E2E_START_SERVERS=true` to let Playwright start the API and apps |

CI (`.github/workflows/ci.yml`) runs all of the above plus Docker image builds.

## Acceptance scenarios (PRD §12)

| ID | Automated test |
|---|---|
| AC-01 | `auth-tenancy.int-spec.ts` — registration creates exactly one central Free subscription, no payment/code; e2e journey 1 |
| AC-02 | `auth-tenancy` (direct create) and `imports.int-spec.ts` (import rows beyond the limit rejected individually); e2e journey 1 (sixth employee refused in the UI) |
| AC-03 | `licensing.int-spec.ts` — paid subscription refused without a VERIFIED payment; separate verifier; e2e journey 2 |
| AC-04 / AC-05 | `licensing` — one-time redemption, wrong-tenant rejection, concurrent redemption cannot double-activate; e2e journey 2 (replay rejected) |
| AC-06 | `workflow-payroll.int-spec.ts` — monthly timesheet rejected (API and import); payroll uses configured 173.33 |
| AC-07 | `workflow-payroll` — delegated submission stores subject and actor; approval policy unchanged; e2e journey 3 |
| AC-08 / AC-09 / AC-10 | `workflow-payroll` — snapshot contains overtime/leave and rule version; locked run edits rejected (API and DB triggers); reversal; audited payslip print; e2e journey 3 |
| AC-11 | `licensing` — after expiry + grace writes blocked, historical reads and payslips available |
| AC-12 | `auth-tenancy` — cross-tenant ID substitution never returns or modifies another tenant's data |
| AC-13 | `imports` — mixed-validity import: every row has an outcome, valid rows committed once, retry does not duplicate |
| AC-14 | `licensing` — renewal with a newly verified payment, linked once, no new code |
| AC-15 | `auth-tenancy` — company rename propagates to session branding and exports |

Additional coverage: reference-pack import and cumulative PAYE end-to-end; notification routing,
preferences and reminder de-duplication; retention purge, legal hold, trigger bypass scoping and account
closure; invoice numbering, payment matching, receipts and statements; SSO (PKCE, state, nonce, issuer,
verified-email rules, Microsoft linking, invitation acceptance).

Additional security coverage: CSRF/session-bound token, unverified login refusal and non-enumeration,
login lock-out/rate limiting, MFA enforcement for privileged roles, MFA reset rules (tenant scope,
platform permission, session revocation, audit), field encryption tamper detection, audit redaction,
upload magic-number sniffing, CSV formula-injection protection.

## End-to-end journeys (`tests/e2e/journeys.e2e.ts`)

1. **Free onboarding** — landing → register → email verification → sign-in → mandatory MFA enrolment →
   five employees created, the sixth refused with the plan-limit message → Subscription page shows Free.
2. **Paid activation** — licensing officer records a manual payment → a different super admin verifies
   it → subscription created with a one-time code (shown once) → the tenant admin redeems it → plan
   active; redeeming the same code again is rejected.
3. **Delegated time to payslip** — Manager enters a timesheet for an employee → Admin approves → Payroll
   Officer creates and prepares a weekly run (cannot review it) → Finance Approver reviews, approves and
   locks → Manager prints the approved payslip; the print is recorded with user, employee and tenant.

## Latest local results (this release)

| Suite | Result |
|---|---|
| Lint | 0 errors, 0 warnings |
| Typecheck | all workspaces pass |
| Unit | 73 tests pass (engine 26 incl. hand-calculated Jamaica pack and cumulative cases, authorization 9, types 8, UI 6, API 6, HRMS web 9, Licence Manager web 3, migration 6) |
| Integration (MySQL 8.0 locally; CI uses 8.4) | 47 / 47 pass (adds reference pack + cumulative PAYE, notifications, data lifecycle, billing, SSO with a mock OpenID provider) |
| E2E (Chromium) | 3 / 3 journeys pass |
| Docker | all five images build; the compose stack starts healthy; browser smoke test (registration → email via Mailpit → MFA → S3 logo upload/download) passes |
| Legacy migration | transform → load → re-load (idempotent) → reconcile: 26 / 26 checks pass on the synthetic sample |

## Not yet performed

Load/performance testing, independent penetration testing, accessibility audit, backup restore drill,
and the payroll specialist's reference-calculation pack (see [known limitations](known-limitations.md)).
