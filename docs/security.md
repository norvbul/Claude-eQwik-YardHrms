# Security notes

How the platform protects tenant data, and what remains for the operator. Report suspected
vulnerabilities privately to Qwik Business Solutions; do not open public issues.

## Tenant isolation

- The active tenant comes **only** from the server-side session (selected at sign-in or via
  `switch-tenant` against an ACTIVE membership) — never from request bodies, query strings or headers.
- Every tenant-owned table carries `tenant_id`; relations use **composite foreign keys**
  (`tenant_id, id`) so a row cannot reference another tenant's row even through a bug.
- Services query with `tenantId` in every `where` clause; lookups by ID that do not match the tenant
  return 404 (no existence oracle). Adversarial tests (AC-12) swap employee/run/payslip/import IDs
  between tenants and assert nothing leaks or changes.
- Platform (Qwik) staff use a separate app, cookie (`qp_sid`, SameSite=Strict) and permission set. The
  platform API exposes customers, subscriptions, payments, codes, usage **counts** and
  subscription/licence audit events — there is no platform endpoint that returns employee, timesheet,
  leave or payroll records, and platform audit views exclude tenant HR/payroll audit detail.

## Authentication & sessions

- Passwords: Argon2id; minimum length and complexity enforced by shared schemas. Account lock for 15
  minutes after 5 consecutive failures; generic error messages; registration and reset flows do not
  reveal whether an email exists.
- Email verification and password reset use single-use random tokens stored as HMAC hashes with expiry.
- Sessions: random 256-bit tokens in HttpOnly cookies (`Secure` required in production; `SameSite=Lax`
  tenant, `Strict` platform); only an HMAC of the token is stored. Idle and absolute expiry; the token
  is rotated on privilege changes (MFA completion, tenant switch); sessions are revoked on password
  change/reset, user deactivation and sign-out.
- MFA (TOTP, RFC 6238) is mandatory for all Qwik staff and for Company Administrator, Payroll Officer
  and Finance Approver roles; secrets are encrypted at rest. A session that has not completed MFA can
  only reach MFA endpoints.
- MFA reset (lost authenticator) requires a recorded identity-verification reason, revokes every session
  and emails the account holder. Company Administrators may reset only users whose sole organisation is
  their own (never themselves or Qwik staff); anything else needs a Qwik Super Admin
  (`platform.accounts.mfa_reset`). Both paths are audited.

## Request protection

- CSRF: every state-changing request needs the session-bound `X-CSRF-Token` header and an allowed
  `Origin`; cookies are SameSite.
- Rate limits (Redis-backed, shared across replicas) on register (5/h), login and MFA (10/5 min),
  forgot (5/15 min) and reset password, verification resend, invitation acceptance and code redemption
  (10/h per tenant), in addition to account lock-out.
- Input: every body and query is validated with zod schemas shared with the frontends (unknown fields
  stripped, lengths bounded). Prisma parameterises all SQL; the few raw queries use tagged templates.
- Output: React escapes all rendered data; lint forbids `dangerouslySetInnerHTML`. Helmet sets security
  headers on the API; nginx sets CSP (`script-src 'self'`), `X-Frame-Options: DENY`, nosniff and a strict
  referrer policy for the apps. CSV exports neutralise formula injection (cells starting with `=`, `+`, `-`, `@`); XLSX cells are written as typed values, never formulas.
- Uploads: size limits, type allow-lists per purpose verified by **magic-number sniffing** (the declared
  MIME type is not trusted), random storage keys, private bucket, downloads only through authorised API
  endpoints with `Content-Disposition`. **No malware scanning is built in** — add a scanning step (e.g.
  ClamAV sidecar or the storage provider's scanner) before go-live.

## Authorisation

- Global guard order: rate limit → origin/CSRF → session → MFA → membership → subscription entitlements
  (feature flags, read-only states) → RBAC permissions. Services re-check business rules (separation of
  duties, delegation scope, period locks, capacity).
- Eight tenant role templates plus tenant-defined custom roles; permissions are fine-grained (e.g.
  `employees.sensitive.read`, `compensation.read`, `payslips.print.any`).
- Separation of duties: statutory-rule author ≠ approver; payroll preparer ≠ reviewer/approver (company
  setting); payment recorder ≠ verifier (platform setting); requester cannot approve their own
  leave/timesheet/overtime.

## Data protection

- Field-level AES-256-GCM encryption (`FIELD_ENCRYPTION_KEY`) for TRN, NIS, NHT, bank account numbers
  and MFA secrets; only last-4 digits are stored in clear for display/search. Masked unless the user holds
  the sensitive-data permission.
- Activation codes: generated with a CSPRNG, shown once, stored as HMAC hashes, single-use, expiring,
  bound to a tenant, redeemed under row locks with conditional updates (no double activation).
- Audit trail: append-only (`audit_events`, `subscription_events`, `manual_payment_events`,
  `leave_ledger`) enforced by MySQL triggers; sensitive keys (passwords, tokens, identifiers, bank
  numbers) are redacted before audit storage.
- Payroll immutability: triggers reject updates/deletes of approved or locked runs and their lines.
- Payslip access (view, download, print) is logged per user/employee/tenant.

## Operator responsibilities

TLS and HSTS, encryption at rest for database/bucket/backups, secrets management and key backup,
network isolation, malware scanning, WAF/DDoS protection, log retention and monitoring, vulnerability
patching of base images (rebuild regularly), independent penetration testing before launch and after
major changes, incident response and breach notification under Jamaican data-protection law.

## Known security gaps (release 1)

See [known limitations](known-limitations.md): no malware scanning, no SSO, no automated
data-retention/deletion workflow, no independent penetration test yet.
