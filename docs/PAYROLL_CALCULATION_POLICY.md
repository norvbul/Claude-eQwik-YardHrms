# Payroll configuration & calculation policy

This document is the reference for how eQwik YardHRMS calculates pay, and how a company configures the
rules it calculates with. It is written for payroll officers, finance approvers and the qualified
Jamaican payroll specialist who must sign off the rules before live use.

> **Compliance gate.** The software ships **no statutory rates, thresholds or ceilings**. PAYE, NIS, NHT,
> Education Tax and HEART/NSTA values must be entered by each company from authoritative, current
> sources (legislation, Tax Administration Jamaica / NIS / NHT / HEART notices) and approved inside the
> application. Until a qualified Jamaican payroll specialist has reviewed the rules **and** a signed set
> of reference calculations matches the system output, the platform operator keeps
> `PAYROLL_COMPLIANCE_CERTIFIED=false`, and every payslip and run carries a *Not certified for live
> payroll* banner. Demo tenants use rules labelled *DEMO ONLY — synthetic rates (NOT statutory)*.

## 1. What a company configures

| Setting | Where | Notes |
|---|---|---|
| Pay frequencies | Payroll setup → Pay frequencies | Standard hours per period (Monthly default **173.33**), working days per period, periods per year (52 / 26 / 12 by default). Used for hourly equivalents, unpaid-leave daily rates and periodising annual thresholds. |
| Statutory rule versions | Payroll setup → Statutory rules | Effective-dated versions containing components (see §3). Draft → Approved → Retired. |
| Overtime rules | Payroll setup → Overtime rules | Named multipliers (e.g. 1.5, 2.0) chosen on each overtime request. |
| Allowance types | Payroll setup → Allowances | Taxable or non-taxable; recurring per employee (amount, effective dates) or one-off via run adjustments. |
| Deduction types | Payroll setup → Deductions | Pension, insurance, loan (with running balance), garnishment, union, other; pre-tax or post-tax. |
| Leave types & policies | Leave → Types/Policies | Pay percent (100 = paid, 0 = unpaid, part-paid allowed), entitlements, accrual method, carry-forward and expiry. |
| Employee terms | Employee → Compensation | Pay type (salary/hourly), frequency, salary per period or hourly rate, standard-hours override, overtime eligibility, statutory exemptions on record. Changes are effective-dated and kept in history. |

Changes apply prospectively. Approved and locked payroll runs keep their own snapshot and are never
recalculated, so historical results remain reproducible after configuration changes.

## 2. Statutory rule versions

1. **Create** a version (or clone the latest) with a name, effective-from date, optional effective-to
   and the *source reference* (e.g. the notice or schedule the figures come from). New companies get a
   DRAFT template containing NIS, NHT, EDTAX, PAYE and HEART with **zero** rates — it cannot be approved
   until real values are entered.
2. **Validate** — the system rejects structurally invalid versions: duplicate codes, employee/employer
   or bracket rates outside 0–1, negative thresholds/ceilings, bracket bounds that do not increase, an
   unbounded bracket that is not the last, and a component that reduces statutory income ordered after
   a component that is calculated on statutory income.
3. **Approve** — a different user from the author must approve it (separation of duties) and record an
   attestation (e.g. "Verified against TAJ notice … by …"). Approving closes the previous open-ended
   version the day before the new one starts.
4. **Use** — a run uses the APPROVED version effective on the **period end date**. If none exists,
   preparation stops with "No APPROVED statutory rule version is effective for this period".
5. **Retire** — allowed only when no in-progress run uses the version. Approved versions are never
   edited; to change figures, clone and approve a new version.

## 3. Components

Each component has: `code`, `name`, `sortOrder`, `base`, `employeeRate`, `employerRate`, optional
`annualThreshold`, optional `annualCeiling`, optional progressive `brackets` (annual band limits with a
rate each), optional `minAge`/`maxAge`, and `reducesStatutoryIncome`.

`base` is one of:

- `GROSS` — all earnings;
- `TAXABLE_GROSS` — earnings flagged taxable;
- `STATUTORY_INCOME` — taxable gross less pre-tax voluntary deductions, then less the employee amounts of
  earlier components that have `reducesStatutoryIncome = true` (processed in `sortOrder`).

The template's ordering and bases (NIS on taxable gross reducing statutory income; NHT on gross; EDTAX
and PAYE on statutory income; HEART employer-only on gross) are **structural defaults to be confirmed
by the payroll specialist**, not a statement of law.

## 4. Order of operations (per employee, per period)

Implemented in `packages/payroll-engine/src/engine.ts` (`calculatePay`):

1. **Basic pay**
   - Salary: `salaryPerPeriod × prorationFactor`. Proration = working days employed in the period ÷
     working days in the period (weekends and company public holidays excluded), applied when the hire
     or termination date falls inside the period.
   - Hourly: approved regular timesheet hours × hourly rate.
2. **Hourly equivalent**: salary ÷ standard hours per period (Monthly 173.33 unless the company or the
   employee overrides it); hourly staff use their rate. Monthly employees never submit regular
   timesheets.
3. **Overtime**: approved overtime hours × hourly equivalent × the rule's multiplier. Only
   overtime-eligible employees can have approved overtime.
4. **Leave**: for salaried staff, the unpaid share of approved leave days reduces pay at the daily rate
   (salary ÷ working days per period × unpaid percent). For hourly staff, the paid share of approved
   leave adds hours at the hourly rate.
5. **Allowances and one-off earnings** (bonus, commission, retro, other) with their taxable flag.
6. **Statutory components** in `sortOrder` (§3). For each: base → cap at the periodised ceiling →
   subtract the periodised threshold → apply the flat rate or the progressive brackets (bands periodised
   the same way) → employer amount at the employer rate on the same amount. Components are skipped
   for an exemption on the employee's record or when the employee's age at period end is outside the
   component's age limits; the payslip line shows the reason.
7. **Voluntary deductions** (fixed amounts or loan instalments; loan balances are reduced when the run is
   approved). Pre-tax deductions reduce statutory income in step 6.
8. **Net pay** = gross − statutory employee amounts − voluntary deductions. A negative net is flagged as
   a warning that must be resolved before approval.

**Periodisation:** annual thresholds, ceilings and bracket limits are divided by periods per year for
the run's frequency. Calculations are **per period** — there is no cumulative year-to-date
annualisation or true-up. If Jamaican rules applied by the company require cumulative treatment, this
must be raised with the payroll specialist before go-live (see known limitations).

**Rounding and precision:** all arithmetic uses decimal (40 significant digits, no binary floating
point). Every money line is rounded **half-up to 2 decimal places** when produced; totals are sums of
rounded lines. Hourly equivalents are stored to 4 decimal places.

## 5. Run lifecycle and controls

`Draft → Prepared → Reviewed → Approved → Locked`

| Step | Who (default roles) | Effect |
|---|---|---|
| Create | Payroll Officer | Period (frequency, start, end, pay date), selection by department/employees |
| Prepare | Payroll Officer | Calculates every selected employee from approved timesheets, overtime, leave and pay items; employees that cannot be calculated are listed as exceptions, and warnings (e.g. negative net) are shown per employee |
| Review | Finance Approver / Admin | With the company setting *require separate approver* (on by default), the reviewer/approver must differ from the preparer |
| Approve | Finance Approver / Admin | Freezes the snapshot (inputs, lines, rule version, actors, SHA-256 hash); issues payslips; applies loan balances |
| Lock | Finance Approver / Admin | Closes the pay period: no further timesheet/leave/overtime changes for it |
| Reopen | Payroll/Finance | Only Prepared/Reviewed runs can return to Draft |
| Reverse | Finance Approver / Admin | Creates a reversal run that negates an approved run; corrections then go in a new or supplemental run |

Database triggers reject any change to approved/locked run data, including direct SQL by the
application user. Supplemental runs pay adjustments (bonus, commission, retro, allowance, deduction)
outside the regular cycle.

## 6. Outputs

- **Payslips** — PDF per employee in private storage; view/print/download for the employee and permitted
  roles, every access logged with user, employee, tenant and time.
- **Bank file** — CSV or XLSX per approved run; employees without a verified bank account are listed as
  exceptions; each generation is audited.
- **Reports** — payroll register, statutory summary, employer contributions, department costs,
  earnings/deductions, payslip history, bank-file history.

## 7. Before live payroll — checklist

1. Enter each statutory component from the current authoritative source, with the source reference.
2. Have a second authorised user approve the version with an attestation.
3. Agree a **reference pack** with the payroll specialist: representative weekly, fortnightly and monthly
   employees (salaried and hourly, with overtime, unpaid leave, allowances, pre-tax deductions, age
   exemptions, ceilings reached) and their signed expected results.
4. Run those cases in a non-production tenant and compare line by line. Add the cases to the engine's
   regression tests (`packages/payroll-engine/src/engine.test.ts`) with the version's effective date.
5. Run one full pay cycle in parallel with the existing payroll and resolve every difference.
6. Only then does the platform operator set `PAYROLL_COMPLIANCE_CERTIFIED=true` for the environment.
