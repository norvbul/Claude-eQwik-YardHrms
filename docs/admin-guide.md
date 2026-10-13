# Company administrator guide

For the people who run eQwik YardHRMS inside a company: Company Administrators, HR Officers, Payroll
Officers, Finance Approvers and Managers. Employees see a reduced self-service version of the same app.

## 1. Getting started

1. **Register** at the landing page (*Start Free*): legal name, display name, your name, work email,
   password, acceptance of the licence. Verify your email from the link you receive.
2. **Sign in** and **enrol MFA**: scan the QR code with an authenticator app (Google Authenticator,
   Microsoft Authenticator, 1Password…) and enter the 6-digit code. MFA is required for Company
   Administrators, Payroll Officers and Finance Approvers.
3. Your company starts on the **Free** plan (5 active employees, 2 users; employees, leave and
   timesheets). Paid plans are activated by Qwik after a manual payment — see §10.
4. Complete **Company settings** (§2), then add employees (§3) and invite colleagues (§9).

If you belong to more than one company, choose the organisation after sign-in or switch from the user
menu. Every screen shows the company you are working in.

## 2. Company settings and master data

*Company Settings → Profile & branding*: registered and trading names, TRN, NIS/NHT employer numbers,
address and parish, contacts, logo (PNG/JPEG/WebP) and accent colour. The name and logo appear in the
sidebar, header, browser title, payslips and exported reports.

The other tabs maintain **departments, branches, positions, employment types, shift types and public
holidays**. Codes must be unique; deactivate rather than delete items that are in use. Public holidays
are excluded from leave working-day counts and salary proration.

## 3. Employees

*Employees → Add employee*. Required: first and last name, hire date, pay frequency, pay type and the
salary per pay period (salaried) or hourly rate (hourly). Monthly employees must be salaried.

- **Employee numbers** are generated (`EMP-0001`…) or entered manually; they are unique in the company.
- **Identifiers** (TRN — 9 digits, NIS, NHT) and **bank accounts** are encrypted and shown masked to users
  without the sensitive-data permission.
- **Compensation changes** are effective-dated with a reason and kept in history; **personal-data
  changes** are audited with before/after values.
- **Deactivate/terminate** instead of deleting: history, payslips and leave remain. Inactive employees
  do not count towards your plan's employee limit; **reactivating** does, and is refused if the plan is
  full.
- Tabs on the employee record: emergency contacts, bank accounts, documents (private, permission
  controlled), recurring allowances and deductions (loans with balances), compensation and employment
  history, leave balances.

## 4. Leave

1. Configure **leave types** (paid percent, document required) and **policies** (annual entitlement,
   accrual method, carry-forward limit and expiry) — HR Officer / Administrator.
2. Employees request leave for themselves; HR, Payroll and Managers can also **record leave on behalf
   of** an employee — the system stores both the employee and the person who entered it.
3. Approvers approve or reject with comments. You cannot approve your own request.
4. Balances come from an append-only ledger: opening balances, monthly accruals (run automatically by
   the worker), usage, adjustments (with reason), year-end carry-forward and expiry.
5. Approved unpaid or part-paid leave reduces salary in the payroll period it falls in.

## 5. Timesheets and overtime

- Only **weekly and fortnightly** employees submit regular timesheets. **Monthly employees never do** —
  their pay uses the configured standard hours (173.33 by default).
- A timesheet has a work date, optional shift, start/end time (overnight allowed), break hours; regular
  hours are calculated. Duplicates and overlapping entries are rejected, as are entries for locked pay
  periods.
- **Overtime** is a separate request for overtime-eligible employees (including eligible monthly staff),
  with the overtime rule (multiplier) and hours; it needs its own approval.
- Managers, Payroll Officers and Administrators can submit for any eligible employee; submissions start
  **Pending** and need approval by someone else. Only approved records reach payroll.
- Use bulk approve on the list to approve many pending items you are allowed to approve.

## 6. Payroll

Read the [payroll configuration & calculation policy](PAYROLL_CALCULATION_POLICY.md) first.

1. **Payroll setup**: pay frequencies (standard hours, working days), tax-year start, overtime rules,
   allowance and deduction types, and **statutory rules**. Use *Import reference pack* to start from the
   researched Jamaica figures (imported as a draft), or enter values yourself. A *different* authorised
   user verifies every figure against the cited sources and approves the version with an attestation.
   Payroll cannot be prepared without an approved, effective version.
2. **Create a run**: frequency, period start/end, pay date, optionally a department.
3. **Calculate & prepare** (Payroll Officer). Review exceptions and warnings; fix data (e.g. approve
   outstanding timesheets) and recalculate as often as needed while the run is Draft/Prepared.
4. **Mark reviewed** and **Approve** (Finance Approver; must be a different person from the preparer
   unless your company disables that rule). Approval freezes the snapshot and issues payslips.
5. **Lock** to close the period: timesheets, leave and overtime for it can no longer change.
6. **Bank file**: download CSV/XLSX for your bank upload; employees without a bank account are listed.
7. **Corrections**: approved runs cannot be edited. Use **Reverse** (creates a reversal run) and pay the
   correct amounts in a new or **supplemental** run (bonus, commission, retro, allowance, deduction
   adjustments).

While the platform is in its pre-certification phase every run and payslip shows *Not certified for live
payroll*; do not use the figures for real payments until your payroll specialist has signed off.

## 7. Payslips

Employees see their own approved payslips. Administrators, Payroll Officers and Managers with the
"print any payslip" permission can search by employee and year, view, download or print. **Every view,
download and print is recorded** (who, which employee, when) and visible in the payslip's access log.

## 8. Reports, imports and audit

- **Reports**: employee roster, hires/terminations, leave requests and balances, absenteeism, timesheet
  and overtime summaries, payroll register, statutory summary, employer contributions, department costs,
  earnings and deductions, payslip and bank-file history. Export to CSV, XLSX or PDF; exports are audited.
- **Bulk imports** (Professional/Business): download the template, fill it, upload (XLSX or CSV), check
  the column mapping and preview, then execute. Every row ends **Created, Updated, Rejected or Skipped**
  with a reason; download the error file, fix and re-upload — rows already imported are not duplicated.
  Employee import: blank employee number creates, an existing number updates (blank cells keep existing
  values). Timesheet import enforces the same rules as manual entry.
- **Audit log** (Professional/Business): who did what and when, with before/after for changes. Entries
  cannot be edited or deleted by anyone.

## 9. Users and roles

*Users & Roles → Invite user*: email, name, role(s), optionally linked employee record (for
self-service). Invited users count against your plan's user seats until they accept or you cancel.

| Role | Typical use |
|---|---|
| Company Administrator | Everything in the company, including users, settings and subscription (MFA) |
| HR Officer | Employees, leave, timesheets, overtime, HR reports |
| Payroll Officer | Payroll setup and preparation, timesheets/overtime on behalf, payslips (MFA) |
| Finance Approver | Reviews, approves and locks payroll; statutory approval; payroll reports (MFA) |
| Manager / Supervisor | Team leave/timesheets/overtime on behalf and approvals, payslip printing |
| Employee | Own profile, leave, timesheets (weekly/fortnightly), overtime, payslips |

You can create custom roles from the permission list. Deactivating a user signs them out immediately and
frees the seat.

## 10. Subscription

*Subscription* shows your plan, status, dates, features and usage (active employees and users against
limits).

- **Upgrading or renewing**: pay Qwik Business Solutions by the agreed manual method (bank transfer,
  cash, cheque). Once Qwik verifies the payment you either receive a **one-time activation code** to
  enter here, or Qwik applies the plan to your company directly. Renewals extend the existing
  subscription — no new code is needed.
- **Grace period**: after the paid period ends, the plan's grace days apply with a warning banner.
- **Expired / suspended**: the workspace becomes **read-only**. Nothing is deleted; you can still view and
  export your data and approved payslips, and everything is available again when the subscription is
  renewed.
- Downgrades never delete data; if you are over a lower plan's limit you simply cannot add or reactivate
  employees/users until you are within it.

## 11. Your account

*Account & security* (user menu): change password (signs out other sessions), MFA status, active
organisation.

**Lost authenticator.** A Company Administrator can use *Users & Roles → Reset MFA* for a colleague whose
only organisation is this company, after verifying their identity out of band (in person, or a call-back
to a known number) and recording how. The person is signed out everywhere, notified by email and must
enrol a new authenticator at next sign-in. Administrators cannot reset their own MFA; if you are the only
administrator, or the person also belongs to another organisation, contact Qwik support.

## 12. Notifications

The bell in the header lists everything that needs your attention: leave, timesheets and overtime waiting
for your approval, decisions on requests you submitted, payroll runs ready for review or approval, new
payslips and (for administrators) subscription renewal reminders 30, 14, 7 and 1 day(s) before expiry.
Each also arrives by email; turn off the categories you do not want under *Account & security →
Notifications* (subscription notices to administrators cannot be turned off). Payslips are never attached
to emails.

## 13. Data & privacy (Company Administrators)

*Company Settings → Data & privacy*:

- **Retention** — how long records are kept before automatic deletion or anonymisation. Payroll records,
  former employees' details and the audit log are kept at least seven years (Income Tax (Employments)
  Regulations); you can lengthen but not shorten these. Former employees are anonymised (name replaced,
  identifiers and contact details removed) while their payroll history is kept.
- **Export all data** — a ZIP with every record as CSV plus payslip PDFs, ready within minutes and
  available for seven days. It contains TRN/NIS/NHT and bank numbers: store it securely.
- **Close account** — type the company name to confirm. Nothing happens for 30 days (any administrator can
  cancel); Qwik then confirms the closure. Access ends, data not required by law is erased, and payroll
  records are kept inaccessible until their retention period ends, then deleted.

## 14. Sign in with Google or Microsoft

If your administrator's provider is enabled, use *Continue with Google/Microsoft* on the sign-in page.
Your account must already exist (registered or invited — an invitation is accepted by signing in this
way). Google accounts are matched by verified email. For Microsoft work accounts you may need to link
first: sign in with your password, then *Account & security → Single sign-on → Link Microsoft*. Two-step
verification is still required for administrator, payroll and finance roles.

## 15. Billing documents

*Subscription → Billing documents* lists invoices and receipts from Qwik Business Solutions and gives a
statement for the year. Pay by bank transfer, cash or cheque quoting the invoice number; once Qwik
verifies the payment the invoice shows as paid and a receipt becomes available.
