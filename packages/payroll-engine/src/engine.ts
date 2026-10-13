import { D, Dec, ZERO, dec, max, min, money, roundMoney, sum } from './money';
import type {
  DeductionLine,
  EarningLine,
  EmployeePayInput,
  PayFrequency,
  PayResult,
  StatutoryComponentDef,
  StatutoryLine,
  StatutoryRuleSet,
} from './types';

/** Periods per year used to periodize annual thresholds and ceilings (documented policy). */
export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  WEEKLY: 52,
  FORTNIGHTLY: 26,
  MONTHLY: 12,
};

export function periodsPerYear(freq: PayFrequency, overrides?: Partial<Record<PayFrequency, number>>): number {
  return overrides?.[freq] ?? PERIODS_PER_YEAR[freq];
}

export interface RuleValidationIssue {
  code: string;
  message: string;
}

/** Structural validation of a statutory rule version before it can be approved. */
export function validateRuleSet(components: StatutoryComponentDef[]): RuleValidationIssue[] {
  const issues: RuleValidationIssue[] = [];
  const codes = new Set<string>();
  const sorted = [...components].sort((a, b) => a.sortOrder - b.sortOrder);
  let seenStatutoryIncomeUser = false;
  for (const c of sorted) {
    if (codes.has(c.code)) issues.push({ code: c.code, message: `Duplicate component code ${c.code}` });
    codes.add(c.code);
    for (const [label, v] of [
      ['employeeRate', c.employeeRate],
      ['employerRate', c.employerRate],
    ] as const) {
      const r = dec(v);
      if (r.isNegative() || r.greaterThan(1)) issues.push({ code: c.code, message: `${label} must be between 0 and 1` });
    }
    if (c.annualCeiling != null && dec(c.annualCeiling).isNegative()) issues.push({ code: c.code, message: 'annualCeiling cannot be negative' });
    if (c.annualThreshold != null && dec(c.annualThreshold).isNegative()) issues.push({ code: c.code, message: 'annualThreshold cannot be negative' });
    if (c.brackets?.length) {
      let prev: Dec | null = null;
      c.brackets.forEach((b, i) => {
        const r = dec(b.rate);
        if (r.isNegative() || r.greaterThan(1)) issues.push({ code: c.code, message: `Bracket ${i + 1} rate must be between 0 and 1` });
        if (b.upToAnnual === null && i !== c.brackets!.length - 1) issues.push({ code: c.code, message: 'Only the last bracket may be unbounded' });
        if (b.upToAnnual !== null) {
          const up = dec(b.upToAnnual);
          if (prev && !up.greaterThan(prev)) issues.push({ code: c.code, message: 'Bracket bounds must be increasing' });
          prev = up;
        }
      });
    }
    if (c.base === 'STATUTORY_INCOME') seenStatutoryIncomeUser = true;
    if (c.reducesStatutoryIncome && seenStatutoryIncomeUser && c.base !== 'STATUTORY_INCOME') {
      issues.push({
        code: c.code,
        message: `${c.code} reduces statutory income but is ordered after a component that uses statutory income`,
      });
    }
  }
  return issues;
}

function progressive(amountPerPeriod: Dec, brackets: NonNullable<StatutoryComponentDef['brackets']>, ppy: number): Dec {
  let remaining = amountPerPeriod;
  let lower = ZERO;
  let tax = ZERO;
  for (const b of brackets) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const upper = b.upToAnnual === null ? null : dec(b.upToAnnual).dividedBy(ppy);
    const width = upper === null ? remaining : max(ZERO, upper.minus(lower));
    const slice = min(remaining, width);
    tax = tax.plus(slice.times(dec(b.rate)));
    remaining = remaining.minus(slice);
    if (upper !== null) lower = upper;
  }
  return tax;
}

/**
 * Calculates one employee's pay for one period.
 *
 * Order of operations (documented in docs/PAYROLL_CALCULATION_POLICY.md):
 *  1. Basic pay: SALARY = salaryPerPeriod × prorationFactor; HOURLY = approved regular hours × rate.
 *  2. Hourly equivalent: SALARY = salaryPerPeriod ÷ standardHoursPerPeriod; HOURLY = hourlyRate.
 *  3. Overtime = hours × hourly equivalent × multiplier (only approved overtime is supplied).
 *  4. Leave: unpaid portion of leave days reduces salaried basic pay at the daily rate
 *     (salaryPerPeriod ÷ workingDaysPerPeriod); paid leave for hourly staff adds hours at the paid percent.
 *  5. Allowances and one-off earnings added with their taxable flag.
 *  6. Statutory components in sortOrder, using periodized annual thresholds/ceilings.
 *  7. Voluntary deductions; net = gross − statutory employee amounts − voluntary deductions.
 *  Every money line is rounded half-up to 2 dp when produced; totals are sums of rounded lines.
 */
export function calculatePay(input: EmployeePayInput, rules: StatutoryRuleSet, opts?: { periodsPerYear?: Partial<Record<PayFrequency, number>> }): PayResult {
  const warnings: string[] = [];
  const ppy = periodsPerYear(input.payFrequency, opts?.periodsPerYear);
  const standardHours = dec(input.standardHoursPerPeriod);
  const workingDays = dec(input.workingDaysPerPeriod);
  if (standardHours.lessThanOrEqualTo(0)) throw new Error('standardHoursPerPeriod must be positive');
  if (workingDays.lessThanOrEqualTo(0)) throw new Error('workingDaysPerPeriod must be positive');
  const proration = input.prorationFactor == null ? new D(1) : dec(input.prorationFactor);
  if (proration.isNegative() || proration.greaterThan(1)) throw new Error('prorationFactor must be between 0 and 1');

  const earnings: EarningLine[] = [];
  let hourlyEquivalent: Dec;

  if (input.payType === 'SALARY') {
    const salary = dec(input.salaryPerPeriod);
    if (salary.isNegative()) throw new Error('salaryPerPeriod cannot be negative');
    hourlyEquivalent = salary.dividedBy(standardHours);
    const basic = roundMoney(salary.times(proration));
    earnings.push({
      code: 'BASIC',
      category: 'BASIC',
      description: proration.lessThan(1) ? `Basic salary (prorated ${proration.times(100).toDecimalPlaces(2).toString()}%)` : 'Basic salary',
      quantity: null,
      rate: null,
      amount: basic.toFixed(2),
      taxable: true,
    });
    const dailyRate = salary.dividedBy(workingDays);
    for (const l of input.leave) {
      const unpaidPct = new D(100).minus(dec(l.payPercent));
      if (unpaidPct.lessThanOrEqualTo(0)) continue;
      const amt = roundMoney(dec(l.days).times(dailyRate).times(unpaidPct).dividedBy(100));
      if (amt.isZero()) continue;
      earnings.push({
        code: 'LEAVE_UNPAID',
        category: 'LEAVE_UNPAID',
        description: `${l.description} (${unpaidPct.toString()}% unpaid)`,
        quantity: dec(l.days).toString(),
        rate: roundMoney(dailyRate).toFixed(2),
        amount: amt.negated().toFixed(2),
        taxable: true,
      });
    }
    if (input.approvedRegularHours && dec(input.approvedRegularHours).greaterThan(0)) {
      warnings.push('Regular timesheet hours were supplied for a salaried employee and were not used for pay.');
    }
  } else {
    const rate = dec(input.hourlyRate);
    if (rate.lessThanOrEqualTo(0)) throw new Error('hourlyRate must be positive for HOURLY employees');
    hourlyEquivalent = rate;
    const hours = dec(input.approvedRegularHours);
    if (hours.isNegative()) throw new Error('approvedRegularHours cannot be negative');
    earnings.push({
      code: 'BASIC',
      category: 'BASIC',
      description: 'Regular hours',
      quantity: hours.toString(),
      rate: rate.toFixed(2),
      amount: money(hours.times(rate)),
      taxable: true,
    });
    const hoursPerDay = standardHours.dividedBy(workingDays);
    for (const l of input.leave) {
      const paidPct = dec(l.payPercent);
      if (paidPct.lessThanOrEqualTo(0)) continue;
      const amt = roundMoney(dec(l.days).times(hoursPerDay).times(rate).times(paidPct).dividedBy(100));
      if (amt.isZero()) continue;
      earnings.push({
        code: 'LEAVE_PAID',
        category: 'LEAVE_PAID',
        description: `${l.description} (${paidPct.toString()}% paid)`,
        quantity: dec(l.days).toString(),
        rate: roundMoney(hoursPerDay.times(rate)).toFixed(2),
        amount: amt.toFixed(2),
        taxable: true,
      });
    }
  }

  for (const ot of input.overtime) {
    const hours = dec(ot.hours);
    const mult = dec(ot.multiplier);
    if (hours.isNegative()) throw new Error('Overtime hours cannot be negative');
    if (mult.lessThanOrEqualTo(0)) throw new Error('Overtime multiplier must be positive');
    const otRate = hourlyEquivalent.times(mult);
    earnings.push({
      code: 'OVERTIME',
      category: 'OVERTIME',
      description: `${ot.description} @ ${mult.toString()}x`,
      quantity: hours.toString(),
      rate: roundMoney(otRate).toFixed(2),
      amount: money(hours.times(otRate)),
      taxable: true,
    });
  }

  for (const a of input.allowances) {
    earnings.push({ code: a.code, category: 'ALLOWANCE', description: a.description, quantity: null, rate: null, amount: money(dec(a.amount)), taxable: a.taxable });
  }
  for (const e of input.oneOffEarnings) {
    earnings.push({ code: e.code, category: e.category ?? 'OTHER', description: e.description, quantity: null, rate: null, amount: money(dec(e.amount)), taxable: e.taxable });
  }

  const gross = sum(earnings.map((e) => dec(e.amount)));
  const taxableGross = sum(earnings.filter((e) => e.taxable).map((e) => dec(e.amount)));
  const nonTaxable = gross.minus(taxableGross);
  if (gross.isNegative()) warnings.push('Gross pay is negative after leave adjustments.');

  const voluntary: DeductionLine[] = input.voluntaryDeductions.map((v) => {
    const amt = roundMoney(dec(v.amount));
    if (amt.isNegative()) throw new Error(`Deduction ${v.code} cannot be negative`);
    return { code: v.code, description: v.description, category: v.category, amount: amt.toFixed(2), preTax: v.preTax };
  });
  const preTaxTotal = sum(voluntary.filter((v) => v.preTax).map((v) => dec(v.amount)));

  // Statutory components
  let statutoryIncome = max(ZERO, taxableGross.minus(preTaxTotal));
  const statutory: StatutoryLine[] = [];
  const exemptions = new Set(input.statutoryExemptions ?? []);
  const comps = [...rules.components].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const c of comps) {
    const baseRaw = c.base === 'GROSS' ? gross : c.base === 'TAXABLE_GROSS' ? taxableGross : statutoryIncome;
    const base = max(ZERO, baseRaw);
    let exempt = exemptions.has(c.code);
    let note: string | undefined = exempt ? 'Employee exemption on record' : undefined;
    const age = input.ageAtPeriodEnd;
    if (!exempt && age != null && ((c.minAge != null && age < c.minAge) || (c.maxAge != null && age > c.maxAge))) {
      exempt = true;
      note = 'Outside age eligibility';
    }
    const ceiling = c.annualCeiling != null && c.annualCeiling !== '' ? dec(c.annualCeiling).dividedBy(ppy) : null;
    const cappedBase = ceiling ? min(base, ceiling) : base;
    const threshold = c.annualThreshold != null && c.annualThreshold !== '' ? dec(c.annualThreshold).dividedBy(ppy) : ZERO;
    const afterThreshold = max(ZERO, cappedBase.minus(threshold));
    let employee = ZERO;
    let employer = ZERO;
    if (!exempt) {
      employee = c.brackets && c.brackets.length > 0 ? progressive(afterThreshold, c.brackets, ppy) : afterThreshold.times(dec(c.employeeRate));
      employer = afterThreshold.times(dec(c.employerRate));
    }
    const empR = roundMoney(employee);
    const erR = roundMoney(employer);
    statutory.push({
      code: c.code,
      name: c.name,
      base: money(base),
      cappedBase: money(cappedBase),
      taxableAfterThreshold: money(afterThreshold),
      employeeAmount: empR.toFixed(2),
      employerAmount: erR.toFixed(2),
      exempt,
      note,
    });
    if (c.reducesStatutoryIncome) statutoryIncome = max(ZERO, statutoryIncome.minus(empR));
  }

  const totalStatutoryEmployee = sum(statutory.map((s) => dec(s.employeeAmount)));
  const totalEmployer = sum(statutory.map((s) => dec(s.employerAmount)));
  const totalVoluntary = sum(voluntary.map((v) => dec(v.amount)));
  const totalDeductions = totalStatutoryEmployee.plus(totalVoluntary);
  const net = gross.minus(totalDeductions);
  if (net.isNegative()) warnings.push('Net pay is negative; review deductions before approval.');
  if (!rules.approved) warnings.push('Statutory rule version is NOT approved; results are not valid for live payroll.');

  return {
    employeeId: input.employeeId,
    periodsPerYear: ppy,
    hourlyEquivalent: hourlyEquivalent.toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(4),
    earnings,
    grossPay: money(gross),
    taxableGross: money(taxableGross),
    nonTaxableGross: money(nonTaxable),
    statutoryIncome: money(statutoryIncome),
    statutory,
    voluntary,
    totalStatutoryEmployee: money(totalStatutoryEmployee),
    totalVoluntary: money(totalVoluntary),
    totalEmployeeDeductions: money(totalDeductions),
    totalEmployerContributions: money(totalEmployer),
    netPay: money(net),
    ruleVersionId: rules.versionId,
    ruleVersionName: rules.versionName,
    ruleVersionApproved: rules.approved,
    warnings,
  };
}

export interface RunTotals {
  employees: number;
  gross: string;
  taxableGross: string;
  employeeDeductions: string;
  statutoryEmployee: string;
  employerContributions: string;
  net: string;
  byComponent: Record<string, { employee: string; employer: string }>;
}

export function summarize(results: PayResult[]): RunTotals {
  const byComponent: Record<string, { employee: Dec; employer: Dec }> = {};
  for (const r of results) {
    for (const s of r.statutory) {
      const e = (byComponent[s.code] ??= { employee: ZERO, employer: ZERO });
      e.employee = e.employee.plus(dec(s.employeeAmount));
      e.employer = e.employer.plus(dec(s.employerAmount));
    }
  }
  return {
    employees: results.length,
    gross: money(sum(results.map((r) => dec(r.grossPay)))),
    taxableGross: money(sum(results.map((r) => dec(r.taxableGross)))),
    employeeDeductions: money(sum(results.map((r) => dec(r.totalEmployeeDeductions)))),
    statutoryEmployee: money(sum(results.map((r) => dec(r.totalStatutoryEmployee)))),
    employerContributions: money(sum(results.map((r) => dec(r.totalEmployerContributions)))),
    net: money(sum(results.map((r) => dec(r.netPay)))),
    byComponent: Object.fromEntries(Object.entries(byComponent).map(([k, v]) => [k, { employee: money(v.employee), employer: money(v.employer) }])),
  };
}
