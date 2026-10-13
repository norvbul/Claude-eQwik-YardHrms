# Implementation plan & PRD traceability

Source: *eQwik YardHRMS Full-stack React/MySQL PRD* (proposed implementation specification). This file
records how the release-1 scope was delivered, phase by phase, and maps every numbered PRD requirement to
its implementation and verification. Status values:

- **Done** — implemented and covered by automated tests or verified in the running apps.
- **Partial** — implemented in part; the gap is stated.
- **Not done** — not implemented in this release (tracked in [known limitations](known-limitations.md)).
- **Owner** — an operational/legal/commercial decision or activity outside the codebase.

## Delivery phases

| Phase | Scope | Main artefacts |
|---|---|---|
| 1. Foundation | Monorepo, MySQL schema (~60 models, composite tenant FKs), migrations, integrity triggers, config validation, error model, OpenAPI | `prisma/`, `apps/api/src/{config,common,prisma}`, `packages/types` |
| 2. Identity & tenancy | Registration, email verification, Argon2id, server sessions, CSRF, MFA, multi-tenant membership, RBAC, audit | `apps/api/src/{auth,tenancy,users,audit}`, `packages/authorization` |
| 3. Licensing | Plans/features, entitlements, Free provisioning, manual payments, subscriptions, codes, renewals, expiry sweep | `apps/api/src/{licensing,entitlements,platform,subscription}` |
| 4. HR core | Master data, employees (encrypted identifiers, bank accounts, documents, history), leave, timesheets, overtime, delegation | `apps/api/src/{masterdata,employees,leave,time,workflow}` |
| 5. Payroll | Decimal engine, versioned statutory rules with approval, run lifecycle, snapshots, reversals, supplemental runs, payslips, bank files | `packages/payroll-engine`, `apps/api/src/payroll` |
| 6. Imports, reports, jobs | XLSX/CSV templates, staged imports with row outcomes, reports/exports, MySQL-backed job queue, worker | `apps/api/src/{imports,reports,jobs}`, `apps/worker` |
| 7. Frontends | Shared UI kit; YardHRMS app; Licence Manager app | `packages/ui`, `apps/hrms-web`, `apps/license-admin-web` |
| 8. Verification | Unit, integration (AC-01..AC-15), Playwright journeys | `**/*.test.ts`, `apps/api/test/integration`, `tests/e2e` |
| 9. Operations | Dockerfiles, compose stack, CI, lint rules, docs, legacy migration tool | `infra/`, `.github/workflows`, `docs/`, `tools/legacy-migration` |

## Requirement traceability

### 6.1 Landing, branding and tenant identity

| ID | Status | Implementation / evidence |
|---|---|---|
| HR-001 | Done | `apps/hrms-web/src/pages/public/Landing.tsx` — responsive landing, payroll capability cards, plan CTA (no invented prices), content placeholders |
| HR-002 | Done | Company name/logo in sidebar, header, browser title, payslip/export headers (`AppLayout.tsx`, `payslip.service.ts`, `reports/export.util.ts`); AC-15 test |
| HR-003 | Done | About / Licence / Disclaimer / Copyright pages (`Legal.tsx`) with Qwik attribution |
| HR-004 | Done | Branding from the tenant record with initials fallback; no hardcoded customer names |
| HR-005 | Partial | Logo upload and accent colour are configurable (Company settings). Guided onboarding checklist is not implemented |

### 6.2 Login, users and organisation access

| ID | Status | Implementation / evidence |
|---|---|---|
| SEC-001 | Done | Argon2id (`password.service.ts`), verify-email, forgot/reset with hashed one-time tokens, enumeration-safe responses |
| SEC-002 | Done | HttpOnly + SameSite cookies, server-side sessions, idle/absolute expiry, rotation, revocation; Google/Microsoft OpenID Connect sign-in with PKCE, nonce and signature checks (`auth/sso.*`, `sso.int-spec.ts`) |
| SEC-003 | Done | Multi-membership users; explicit active tenant in the session (`switch-tenant`); tenant never taken from request input |
| SEC-004 | Done | Global `AuthGuard` + service-layer checks; tenant-scoped custom roles (`users` module); AC-12 IDOR tests |
| SEC-005 | Done | Invite / resend / deactivate / reactivate; seats counted transactionally including pending invites |
| SEC-006 | Done | TOTP MFA mandatory for Qwik staff and Company Admin / Payroll Officer / Finance Approver (`MFA_ENFORCEMENT=required`, enforced in production) |
| SEC-007 | Done | TRN/NIS/NHT/bank accounts encrypted (AES-256-GCM) and masked unless `employees.sensitive.read`; salary hidden without compensation permission |

### 6.3 Company and master data

| ID | Status | Implementation / evidence |
|---|---|---|
| CFG-001 | Done | Company profile incl. identifiers, address, contacts, locale (en-JM) and time zone (America/Jamaica), logo |
| CFG-002 | Done | Departments, branches (parish), positions, employment types, shift types, public holidays (`master-data`) |
| CFG-003 | Done | `pay_frequency_configs`: standard hours (Monthly 173.33 default), working days, periods per year — editable in Payroll setup |
| CFG-004 | Done | Effective-dated statutory rule versions with author ≠ approver and attestation; leave policies, overtime multipliers, allowance/deduction types |
| CFG-005 | Done | Validation + audit on every change; approved versions immutable and referenced by run snapshots, so past runs reproduce |

### 6.4 Employees

| ID | Status | Implementation / evidence |
|---|---|---|
| EMP-001 | Done | CRUD, deactivate/reactivate, soft history, unique tenant employee number (auto `EMP-0001` or explicit) |
| EMP-002 | Done | Personal/contact data, identifiers, emergency contacts, branch, supervisor, position, status, hire/termination |
| EMP-003 | Done | Compensation with effective dates (history), pay type/frequency, standard-hours override, OT eligibility, encrypted bank accounts |
| EMP-004 | Done | Capacity enforced under a tenant row lock for create, reactivate and import; inactive excluded; AC-02 tests |
| EMP-005 | Partial | Private document vault with permission checks, size limits and magic-number content validation. Antivirus scanning and retention schedules not implemented |
| EMP-006 | Done | Audit events with actor, reason, timestamp and redacted before/after; compensation and employment history tables |

### 6.5 Leave

| ID | Status | Implementation / evidence |
|---|---|---|
| LEA-001 | Done | Seven default categories plus tenant-defined types |
| LEA-002 | Done | Requests with dates, half days, working days, reason, document, requester vs subject, approval history |
| LEA-003 | Partial | Public holidays and weekends excluded from working days. Per-employee work schedules (non Mon–Fri patterns) not modelled |
| LEA-004 | Done | Append-only ledger: opening, accrual (idempotent posting keys, worker job), usage, adjustment, carry-forward, expiry (year-end) |
| LEA-005 | Done | Approve/reject with comments, separation of duties; unpaid/part-paid leave flows into payroll |
| LEA-006 | Done | Delegated leave entry for any active employee by permitted roles; approval evaluated separately |

### 6.6 Timesheets and overtime

| ID | Status | Implementation / evidence |
|---|---|---|
| TIM-001 | Done | Weekly/fortnightly timesheets with date, shift, start/end, breaks, computed regular hours |
| TIM-002 | Done | Monthly employees rejected for regular timesheets (API, import, UI); payroll uses configured 173.33; AC-06 |
| TIM-003 | Done | Separate overtime request/approval, only for OT-eligible employees (incl. monthly) |
| TIM-004 | Done | Non-negative hours, overnight spans, duplicates/overlaps (`active_key` unique), approval states, period-lock conflicts |
| TIM-005 | Done | Delegated entry records subject employee and submitting actor separately; AC-07 + Playwright journey 3 |
| TIM-006 | Done | Only approved records feed payroll; imported/submitted records start Pending |

### 6.7 Payroll

| ID | Status | Implementation / evidence |
|---|---|---|
| PAY-001 | Done | Weekly/fortnightly/monthly runs with period/pay dates; department or employee selection |
| PAY-002 | Done | Monthly salaried pay from contract amount; hourly equivalent from configured standard hours |
| PAY-003 | Done | Basic, approved overtime, taxable/non-taxable allowances, bonus, commission, retro, paid/unpaid leave |
| PAY-004 | Done (engine) / Owner (sign-off) | PAYE, NIS, NHT, Education Tax, HEART as versioned rules; researched Jamaica reference packs importable as DRAFT (`payroll-engine/src/reference/jamaica.ts`); voluntary deductions (pension, insurance, loans, garnishment) |
| PAY-005 | Done | No statutory constants in code; real tenants start with a zero-rate DRAFT template that cannot be approved while all rates are zero |
| PAY-006 | Done | decimal.js, half-up 2 dp per line, documented order of operations; per-period or **cumulative year-to-date** method per component, bracket basis before/after threshold — see [payroll policy](PAYROLL_CALCULATION_POLICY.md). Specialist-approved examples are an owner gate |
| PAY-007 | Done | Draft → Prepared → Reviewed → Approved → Locked with separate preparer/reviewer/approver rules |
| PAY-008 | Done | Snapshot per employee (inputs, lines, rule version, actors, hash); DB triggers reject changes; reversal runs; AC-08/AC-09 |
| PAY-009 | Done | Per-employee PDF payslips in private storage, bank file CSV/XLSX batches, statutory and departmental reports |
| PAY-010 | Done | View/print/download for permitted roles; every access logged (`payslip_access_events`); AC-10 + journey 3 |
| PAY-011 | Partial | Supplemental runs and retro/bonus/commission adjustments; re-preparation acts as recalculation preview. Automatic retroactive arrears calculation from back-dated pay changes is not implemented |

### 6.8 Imports and exports

| ID | Status | Implementation / evidence |
|---|---|---|
| IMP-001 | Done | XLSX/CSV upload; versioned downloadable templates with instructions sheet |
| IMP-002 | Done | Preview, column mapping, per-row validation, duplicate detection, summary counts, error CSV |
| IMP-003 | Done | Blank ID creates, existing ID updates; blank cells keep values; changes audited; AC-13 |
| IMP-004 | Done | Eligibility, dates, shifts, duplicates, monthly restriction |
| IMP-005 | Done | Staged batch + job queue; per-row transactions; retry without duplicate replay |
| IMP-006 | Done | CSV/XLSX/PDF exports scoped to tenant and permission; audited |

### 6.9 Dashboard, reporting, self-service

| ID | Status | Implementation / evidence |
|---|---|---|
| RPT-001 | Done | Role-aware dashboard (workforce, leave, pending approvals, attendance, payroll, subscription usage) |
| RPT-002 | Done | Roster, hires/terminations, leave requests/balances, absenteeism, timesheet and overtime summaries |
| RPT-003 | Done | Register, statutory summary, employer contributions, department costs, earnings/deductions, payslip and bank-file history |
| RPT-004 | Done | Employee self-service: profile, leave, eligible timesheets, overtime, own payslips |
| RPT-005 | Done | Every report checks RBAC, plan feature and tenant; exports audited |

### 7. Licence & Subscription Manager

| ID | Status | Implementation / evidence |
|---|---|---|
| LIC-001 | Done | Products, plans (price/currency optional — no invented prices), durations, features, limits, grace |
| LIC-002 | Done | Customers linked to tenants, contacts, subscription history |
| LIC-003 | Done | Manual payments (cash/transfer/cheque/other), invoice/reference, period, private evidence uploads |
| LIC-004 | Done | Pending/Verified/Rejected/Reversed with reason/actor/time; optional separate verifier (`PAYMENT_REQUIRE_SEPARATE_VERIFIER`) |
| LIC-005 | Done | Activation requires a verified, unconsumed payment or a privileged reasoned override; AC-03 |
| LIC-006 | Done | CSPRNG codes, shown once, HMAC-hashed, one-time, expiring, tenant-bound, race-safe; AC-04/AC-05 |
| LIC-007 | Done | Central Free provisioning, no code/payment, one Free entitlement per tenant; AC-01 |
| LIC-008 | Done | Tenant Subscription page: plan, status, dates, entitlements, usage, code-entry form |
| LIC-009 | Done | Renewal with verified payment and no code, plan change, capacity adjustment; AC-14 |
| LIC-010 | Done | FREE/TRIAL/ACTIVE/GRACE/EXPIRED/SUSPENDED/REVOKED; feature and read-only enforcement in the guard/services; AC-11 |
| LIC-011 | Done | Transactional counts under tenant lock; downgrades never delete data |
| LIC-012 | Done | Append-only subscription and payment event logs plus platform audit |
| LIC-013 | Partial | Renewals queue and usage views; automatic renewal reminders (30/14/7/1 days), grace and expiry notices. Subscription analytics not implemented |
| LIC-014 | Done | Invoices (gap-free numbering, optional GCT, void), receipts for verified payments, customer statements; tenant access to its own documents (`billing/*`, `billing.int-spec.ts`) |

### 11. Non-functional

| ID | Status | Implementation / evidence |
|---|---|---|
| NFR-001 | Partial | Field-level encryption, S3 SSE option, Secure cookies; TLS termination and encrypted MySQL volumes/backups are deployment tasks ([deployment](deployment.md)) |
| NFR-002 | Owner | Availability target requires hosting, monitoring and on-call |
| NFR-003 | Partial | Async jobs for imports/PDFs, indexed queries; no load test has been run |
| NFR-004 | Owner | Backup/PITR/restore-test procedure documented ([backup-restore](backup-restore.md)); must be operated |
| NFR-005 | Done | Append-only audit enforced by DB triggers; platform staff have no tenant payroll read path |
| NFR-006 | Partial | Automated tests cover IDOR, CSRF/origin, rate limits, session fixation (rotation), upload validation; no independent penetration test yet |
| NFR-007 | Partial | Private storage, size limits, magic-number type validation; antivirus scanning and retention controls not implemented |
| NFR-008 | Partial | Semantic labels, keyboard focus traps, loading/error states; no formal WCAG 2.2 AA audit |
| NFR-009 | Owner | Legal/payroll review of privacy notices and obligations |
| NFR-010 | Partial | Docker images, compose, CI and automated migrations; staging/production environments and secrets manager to be provisioned |
| NFR-011 | Done | Retention policy with legal minimums enforced daily, legal hold, full data-export ZIP, account closure with cooling-off and Qwik approval (`retention/*`, `data-lifecycle.int-spec.ts`) |
| NFR-012 | Partial | In-app + email notifications for approvals, decisions, payroll, payslips and subscription expiry with per-category preferences and history (`notifications/*`); scheduled report emails not implemented |

### 12. Acceptance scenarios

All fifteen scenarios are automated in `apps/api/test/integration` and pass; three end-to-end browser
journeys cover the cross-application flows. See [testing](testing.md).

### 14. Migration

`tools/legacy-migration` implements inventory → mapping → normalise/validate → load (legacy_id_map,
idempotent delta) → reconcile, plus the licence reconciliation report. The parallel payroll run, cutover
and rollback are operational steps described in its [runbook](../tools/legacy-migration/README.md).
