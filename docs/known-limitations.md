# Known limitations & open owner decisions

eQwik YardHRMS is **not production-ready** until the release gates below are closed. This list is kept
honest on purpose: it is what a reviewer, payroll specialist or auditor should read first.

## Release gates (must be closed before live customer data)

1. **Payroll compliance certification.** No Jamaican statutory rates are shipped. Each company must enter
   PAYE, NIS, NHT, Education Tax and HEART/NSTA rules from authoritative sources and approve them; a
   qualified Jamaican payroll specialist must accept a signed reference-calculation pack for weekly,
   fortnightly and monthly payroll before `PAYROLL_COMPLIANCE_CERTIFIED=true`
   ([policy](PAYROLL_CALCULATION_POLICY.md) §7).
2. **Calculation basis review.** Statutory components are calculated **per period** with annual
   thresholds, ceilings and bands periodised by periods-per-year. Cumulative year-to-date annualisation
   or true-ups are **not** implemented. The specialist must confirm the per-period basis is acceptable
   for each component, or the engine must be extended before go-live.
3. **Independent security testing.** Automated tests cover tenant isolation (IDOR), CSRF/origin checks,
   rate limiting, session handling and upload validation, but no independent penetration test has been
   performed.
4. **Malware scanning of uploads** (employee documents, payment evidence, imports, logos) is not built in;
   add a scanner in the storage pipeline.
5. **Operations not yet provisioned:** production/staging hosting, TLS, secrets manager, monitoring and
   alerting, backups with PITR and a completed restore test, load test against the P95 < 500 ms target.
6. **Legal review:** privacy notice, terms of service, data-processing arrangements and the legal text on
   the About/Licence/Disclaimer/Copyright pages must be approved; current text is a placeholder draft.

## Functional gaps (release 1)

| Area | Gap | PRD |
|---|---|---|
| Notifications | No email/in-app notifications for approvals, subscription expiry or scheduled reports (only verification, invitation, password-reset, staff-invite and MFA-reset emails) | NFR-012 |
| Data lifecycle | No retention schedules, tenant data-export bundle or deletion workflow with legal holds | NFR-011 |
| Licence Manager | No invoice/receipt PDFs or customer statements; no renewal notification templates or subscription analytics | LIC-013, LIC-014 |
| Documents | No antivirus scanning or per-document retention policy | EMP-005, NFR-007 |
| Leave | Working days assume a Monday–Friday week minus public holidays; per-employee shift schedules are not modelled | LEA-003 |
| Payroll | Retro arrears are entered as adjustments in supplemental runs; there is no automatic arrears calculation from back-dated pay changes | PAY-011 |
| Payroll | Bank files are a generic CSV/XLSX layout; bank-specific upload formats need mapping per bank | PAY-009 |
| Sign-in | No Google/Microsoft SSO (PRD: optional, later) | SEC-002 |
| Onboarding | No guided onboarding checklist for new companies (branding and settings are configurable) | HR-005 |
| Accessibility | Built with semantic labels, keyboard support and focus management, but not audited against WCAG 2.2 AA | NFR-008 |
| Statutory filings | Reports summarise statutory amounts; no generation of official statutory return files and no direct transmission to authorities (out of scope for release 1) | §3.2 |

## Technical notes

- **MySQL triggers** require `log_bin_trust_function_creators=1` for a non-SUPER application user when
  binary logging is on (MySQL 8.4 default) — see the deployment guide.
- **Object storage:** S3-compatible stores differ. The local Docker stack uses SeaweedFS with
  `S3_SERVER_SIDE_ENCRYPTION=none` because SeaweedFS returned ciphertext for SSE-S3 objects; production
  should use a provider that supports SSE (`AES256`/`aws:kms`). The client sends checksums only when
  required, for compatibility with S3-compatible services.
- **Job queue** is MySQL-backed (`background_jobs`, `FOR UPDATE SKIP LOCKED`) rather than Redis/BullMQ; it
  is durable and simple to operate at the expected volume. Redis is used for rate limiting.
- **API container image** keeps the full workspace `node_modules` (≈1.5 GB uncompressed, ≈300 MB
  compressed) so the generated Prisma client and native modules match the build exactly; a pruned
  production image is a future optimisation.
- **Frontend bundles** are single-page apps (~800 KB JS before gzip for the HRMS); route-level code
  splitting is in place for pages, and further splitting of charting code is possible.
- **Local storage driver** (`STORAGE_DRIVER=local`) is for development only and is refused in
  production.
- The **Docker build** was validated in a sandbox that blocks Debian package mirrors, so the `apt-get
  install openssl` step of `node.Dockerfile` was substituted there with the same libraries from the
  official `node:22-bookworm` image; the CI `docker` job builds the Dockerfiles unmodified.

## Open decisions for owner approval (PRD §17)

| Decision | Current default in the software |
|---|---|
| Tenant delivery model | Logically multi-tenant SaaS (shared database, tenant-scoped rows, composite FKs) |
| Hosting / cloud, region, data residency, backup retention | Not chosen — Docker images are provider neutral |
| Plan pricing, currencies, durations, Free limits, paid entitlements | Seed proposals for limits/features; **prices blank** |
| Login: email/password + MFA vs mandatory SSO | Email/password + mandatory TOTP MFA for privileged roles |
| Payment controls / override roles | Separate verifier **on**; overrides limited to Platform Super Admin |
| Authoritative Jamaican payroll sources, effective dates, test examples | Not provided — gate 1 above |
| Retention periods (payroll, personnel, payslips, audit, documents), cross-border storage | Nothing is deleted automatically |
| Migration: live customers, volumes, historical data to keep queryable | Tooling supports employees, reference data, leave openings and historical payroll with payslips |
| Branding/legal text, trademark usage, terms and privacy notice | Placeholder text with Qwik Business Solutions™ / eQwik YardHRMS™ attribution |
