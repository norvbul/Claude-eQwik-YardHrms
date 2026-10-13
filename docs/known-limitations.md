# Known limitations & open owner decisions

eQwik YardHRMS is **not production-ready** until the release gates below are closed. This list is kept
honest on purpose: it is what a reviewer, payroll specialist or auditor should read first.

## Release gates (must be closed before live customer data)

1. **Payroll compliance certification.** Researched Jamaica *reference packs* (April 2024/2025/2026
   thresholds, NIS, NHT, Education Tax, PAYE, HEART) can be imported, but only as DRAFT rule versions. The
   figures were triangulated from TAJ/JIS-citing sources because government sites could not be fetched
   from the build environment. A second person must verify every figure against TAJ, NIS, NHT and
   HEART/NSTA publications and approve it, and a qualified Jamaican payroll specialist must accept a signed
   reference-calculation pack before `PAYROLL_COMPLIANCE_CERTIFIED=true` ([policy](PAYROLL_CALCULATION_POLICY.md) §7).
2. **Calculation method sign-off.** Each statutory component can run per period or cumulatively over the
   tax year. The reference packs default to the per-period method (TAJ publishes weekly/fortnightly/monthly
   thresholds); the specialist must confirm the method per component. Pension relief caps (20% of
   remuneration) and pensioner exemptions on pension income are not enforced automatically. The HEART/NSTA
   employer-payroll threshold is an organisation-level test the employer must apply.
3. **Independent security testing.** Automated tests cover tenant isolation (IDOR), CSRF/origin checks,
   rate limiting, session handling and upload validation, but no independent penetration test has been
   performed.
4. **Malware scanning of uploads** (employee documents, payment evidence, imports, logos) is not built in;
   add a scanner in the storage pipeline.
5. **Operations not yet provisioned:** production/staging hosting, TLS, secrets manager, monitoring and
   alerting, backups with PITR and a completed restore test, load test against the P95 < 500 ms target.
6. **Legal review:** the Terms of Service and Privacy Notice are complete drafts (Data Protection Act,
   2020 structure) marked for review by Qwik's legal adviser; retention periods (7 years for payroll
   records per the Income Tax (Employments) Regulations) and the data-processing terms must be confirmed
   before publication.
7. **SSO configuration:** Google/Microsoft sign-in is implemented but needs OAuth client registrations;
   Microsoft automatic linking relies on the optional `xms_edov` claim being configured in the app
   registration (otherwise users link from their account page).

## Functional gaps (release 1)

| Area | Gap | PRD |
|---|---|---|
| Notifications | Approvals, decisions, payroll, payslips and subscription expiry are notified in-app and by email; **scheduled report emails** are not implemented | NFR-012 |
| Licence Manager | Renewal reminders go to company admins automatically; no subscription analytics dashboard or editable notification templates | LIC-013 |
| Documents | No antivirus scanning or per-document retention policy | EMP-005, NFR-007 |
| Leave | Working days assume a Monday–Friday week minus public holidays; per-employee shift schedules are not modelled | LEA-003 |
| Payroll | Retro arrears are entered as adjustments in supplemental runs; there is no automatic arrears calculation from back-dated pay changes | PAY-011 |
| Payroll | Bank files are a generic CSV/XLSX layout; bank-specific upload formats need mapping per bank | PAY-009 |
| Sign-in | SSO signs existing users in only (no self-registration via SSO) and does not replace MFA; tenants cannot yet enforce SSO-only sign-in | SEC-002 |
| Data lifecycle | Retention runs daily; there is no per-document retention category (documents follow one rule); export bundles are generated synchronously per job and may be slow for very large tenants | NFR-011 |
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
- **Statutory deletes** past retention use a per-transaction MySQL session flag (`@yardhrms_retention_purge`)
  recognised by the immutability triggers. Anyone with direct SQL access could set it; the triggers are
  defence in depth against application bugs, not a substitute for restricting database access.
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
| Plan pricing, currencies, durations, Free limits, paid entitlements | Proposed annual JMD prices seeded (see [pricing](pricing.md)), editable; GCT registration open |
| Login: email/password + MFA vs mandatory SSO | Email/password + mandatory TOTP MFA for privileged roles |
| Payment controls / override roles | Separate verifier **on**; overrides limited to Platform Super Admin |
| Authoritative Jamaican payroll sources, effective dates, test examples | Not provided — gate 1 above |
| Retention periods (payroll, personnel, payslips, audit, documents), cross-border storage | Researched defaults enforced daily (7 years payroll/personnel/audit, 2 years leavers' documents, 90 days import/bank files); per-company overrides above legal minimums; cross-border storage still open |
| Migration: live customers, volumes, historical data to keep queryable | Tooling supports employees, reference data, leave openings and historical payroll with payslips |
| Branding/legal text, trademark usage, terms and privacy notice | Draft Terms of Service and Privacy Notice published in-app for legal review |
