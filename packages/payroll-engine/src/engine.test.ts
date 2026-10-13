import { describe, expect, it } from 'vitest';
import { calculatePay, summarize, validateRuleSet } from './engine';
import type { EmployeePayInput, StatutoryRuleSet } from './types';
import { prorationFactor, shiftHours, workingDaysBetween, periodEndFor, ageOn } from './calendar';

/**
 * IMPORTANT: The rates below are SYNTHETIC test fixtures chosen for arithmetic clarity.
 * They are NOT Jamaican statutory rates and must never be used as production configuration.
 */
const SYNTHETIC_RULES: StatutoryRuleSet = {
  versionId: 'test-v1',
  versionName: 'Synthetic test rules',
  approved: true,
  components: [
    { code: 'C1', name: 'Capped contribution', sortOrder: 10, base: 'TAXABLE_GROSS', employeeRate: '0.05', employerRate: '0.05', annualCeiling: '1200000', reducesStatutoryIncome: true },
    { code: 'C2', name: 'Flat levy', sortOrder: 20, base: 'GROSS', employeeRate: '0.02', employerRate: '0.03' },
    { code: 'C3', name: 'Levy on statutory income', sortOrder: 30, base: 'STATUTORY_INCOME', employeeRate: '0.01', employerRate: '0.02' },
    {
      code: 'TAX',
      name: 'Progressive tax',
      sortOrder: 40,
      base: 'STATUTORY_INCOME',
      employeeRate: '0',
      employerRate: '0',
      annualThreshold: '600000',
      brackets: [
        { upToAnnual: '1200000', rate: '0.20' },
        { upToAnnual: null, rate: '0.30' },
      ],
    },
  ],
};

const base = (over: Partial<EmployeePayInput> = {}): EmployeePayInput => ({
  employeeId: 'e1',
  payFrequency: 'MONTHLY',
  payType: 'SALARY',
  salaryPerPeriod: '200000',
  standardHoursPerPeriod: '173.33',
  workingDaysPerPeriod: '21.67',
  overtime: [],
  allowances: [],
  oneOffEarnings: [],
  leave: [],
  voluntaryDeductions: [],
  ...over,
});

describe('calculatePay — monthly salary', () => {
  it('computes statutory components with ceilings, thresholds and brackets using decimal arithmetic', () => {
    const r = calculatePay(base(), SYNTHETIC_RULES);
    expect(r.grossPay).toBe('200000.00');
    // C1: ceiling 1,200,000/12 = 100,000 → 5% = 5,000 (employee), 5,000 employer
    const c1 = r.statutory.find((s) => s.code === 'C1')!;
    expect(c1.cappedBase).toBe('100000.00');
    expect(c1.employeeAmount).toBe('5000.00');
    // C2: 2% of 200,000 = 4,000; employer 3% = 6,000
    expect(r.statutory.find((s) => s.code === 'C2')!.employeeAmount).toBe('4000.00');
    expect(r.statutory.find((s) => s.code === 'C2')!.employerAmount).toBe('6000.00');
    // statutory income = 200,000 - 5,000 (C1 reduces) = 195,000; C3 = 1,950
    expect(r.statutory.find((s) => s.code === 'C3')!.employeeAmount).toBe('1950.00');
    // TAX: threshold 50,000/month → 145,000; bracket 1 width 100,000 @20% = 20,000; rest 45,000 @30% = 13,500
    expect(r.statutory.find((s) => s.code === 'TAX')!.employeeAmount).toBe('33500.00');
    expect(r.totalStatutoryEmployee).toBe('44450.00');
    expect(r.totalEmployerContributions).toBe('14900.00'); // 5000 + 6000 + 3900
    expect(r.netPay).toBe('155550.00');
    expect(r.hourlyEquivalent).toBe('1153.8683');
    expect(r.warnings).toEqual([]);
  });

  it('uses the configurable monthly standard hours (default 173.33) for overtime hourly equivalent', () => {
    const r = calculatePay(base({ overtime: [{ hours: '10', multiplier: '1.5', description: 'Weekday OT' }] }), SYNTHETIC_RULES);
    const ot = r.earnings.find((e) => e.category === 'OVERTIME')!;
    // 200000 / 173.33 = 1153.86834… × 1.5 × 10 = 17308.025… → 17308.03
    expect(ot.amount).toBe('17308.03');
    const r2 = calculatePay(base({ standardHoursPerPeriod: '160', overtime: [{ hours: '10', multiplier: '1.5', description: 'OT' }] }), SYNTHETIC_RULES);
    expect(r2.earnings.find((e) => e.category === 'OVERTIME')!.amount).toBe('18750.00');
  });

  it('deducts unpaid leave at the daily rate and keeps paid leave whole', () => {
    const r = calculatePay(
      base({ salaryPerPeriod: '100000', workingDaysPerPeriod: '20', leave: [{ description: 'Unpaid leave', days: '2', payPercent: '0' }, { description: 'Vacation', days: '3', payPercent: '100' }] }),
      { ...SYNTHETIC_RULES, components: [] },
    );
    expect(r.earnings.find((e) => e.category === 'LEAVE_UNPAID')!.amount).toBe('-10000.00');
    expect(r.grossPay).toBe('90000.00');
  });

  it('applies pre-tax deductions to statutory income and taxable flags on allowances', () => {
    const rules: StatutoryRuleSet = { ...SYNTHETIC_RULES, components: [{ code: 'T', name: 'T', sortOrder: 1, base: 'STATUTORY_INCOME', employeeRate: '0.10', employerRate: '0' }] };
    const r = calculatePay(
      base({
        salaryPerPeriod: '100000',
        allowances: [
          { code: 'TRAVEL', description: 'Travel', amount: '5000', taxable: false },
          { code: 'MEAL', description: 'Meal', amount: '2000', taxable: true },
        ],
        voluntaryDeductions: [{ code: 'PEN', description: 'Pension', amount: '5000', category: 'PENSION', preTax: true }],
      }),
      rules,
    );
    expect(r.grossPay).toBe('107000.00');
    expect(r.taxableGross).toBe('102000.00');
    expect(r.statutory[0].base).toBe('97000.00');
    expect(r.statutory[0].employeeAmount).toBe('9700.00');
    expect(r.netPay).toBe('92300.00');
  });

  it('honours age eligibility and recorded exemptions', () => {
    const rules: StatutoryRuleSet = { ...SYNTHETIC_RULES, components: [{ code: 'X', name: 'X', sortOrder: 1, base: 'GROSS', employeeRate: '0.1', employerRate: '0.1', maxAge: 65 }] };
    expect(calculatePay(base({ ageAtPeriodEnd: 70 }), rules).statutory[0].exempt).toBe(true);
    expect(calculatePay(base({ ageAtPeriodEnd: 40, statutoryExemptions: ['X'] }), rules).statutory[0].employeeAmount).toBe('0.00');
    expect(calculatePay(base({ ageAtPeriodEnd: 40 }), rules).statutory[0].employeeAmount).toBe('20000.00');
  });

  it('prorates salary for mid-period hires', () => {
    const r = calculatePay(base({ salaryPerPeriod: '100000', prorationFactor: '0.5' }), { ...SYNTHETIC_RULES, components: [] });
    expect(r.grossPay).toBe('50000.00');
  });

  it('flags unapproved rule versions', () => {
    const r = calculatePay(base(), { ...SYNTHETIC_RULES, approved: false });
    expect(r.warnings.join(' ')).toMatch(/NOT approved/);
  });
});

describe('calculatePay — hourly weekly/fortnightly', () => {
  it('pays approved regular hours plus overtime, periodizing thresholds weekly', () => {
    const rules: StatutoryRuleSet = { ...SYNTHETIC_RULES, components: [{ code: 'T', name: 'T', sortOrder: 1, base: 'GROSS', employeeRate: '0.1', employerRate: '0', annualThreshold: '52000' }] };
    const r = calculatePay(
      base({ payFrequency: 'WEEKLY', payType: 'HOURLY', hourlyRate: '500', salaryPerPeriod: null, standardHoursPerPeriod: '40', workingDaysPerPeriod: '5', approvedRegularHours: '40', overtime: [{ hours: '4', multiplier: '2', description: 'Holiday' }] }),
      rules,
    );
    expect(r.grossPay).toBe('24000.00');
    // threshold 52000/52 = 1000 → (24000-1000)*0.1 = 2300
    expect(r.statutory[0].employeeAmount).toBe('2300.00');
    expect(r.periodsPerYear).toBe(52);
  });

  it('avoids floating point drift (0.1 + 0.2 style inputs)', () => {
    const r = calculatePay(
      base({ payType: 'HOURLY', payFrequency: 'FORTNIGHTLY', hourlyRate: '0.1', approvedRegularHours: '3', salaryPerPeriod: null, standardHoursPerPeriod: '80', workingDaysPerPeriod: '10' }),
      { ...SYNTHETIC_RULES, components: [] },
    );
    expect(r.grossPay).toBe('0.30');
  });

  it('rejects invalid inputs', () => {
    expect(() => calculatePay(base({ payType: 'HOURLY', hourlyRate: '0' }), SYNTHETIC_RULES)).toThrow();
    expect(() => calculatePay(base({ standardHoursPerPeriod: '0' }), SYNTHETIC_RULES)).toThrow();
  });
});

describe('summarize & validateRuleSet', () => {
  it('summarizes run totals per component', () => {
    const a = calculatePay(base(), SYNTHETIC_RULES);
    const b = calculatePay(base({ employeeId: 'e2' }), SYNTHETIC_RULES);
    const t = summarize([a, b]);
    expect(t.gross).toBe('400000.00');
    expect(t.byComponent.C1.employee).toBe('10000.00');
    expect(t.net).toBe('311100.00');
  });
  it('detects invalid rule definitions', () => {
    expect(validateRuleSet(SYNTHETIC_RULES.components)).toEqual([]);
    const bad = validateRuleSet([
      { code: 'A', name: 'A', sortOrder: 1, base: 'STATUTORY_INCOME', employeeRate: '1.5', employerRate: '0' },
      { code: 'A', name: 'dup', sortOrder: 2, base: 'GROSS', employeeRate: '0.1', employerRate: '0', reducesStatutoryIncome: true },
    ]);
    expect(bad.length).toBeGreaterThanOrEqual(3);
  });
});

describe('calendar helpers', () => {
  it('counts working days excluding weekends and holidays', () => {
    // 2026-08-03 (Mon) .. 2026-08-07 (Fri), with 2026-08-06 as a holiday
    expect(workingDaysBetween('2026-08-03', '2026-08-09', { holidays: ['2026-08-06'] })).toBe(4);
    expect(workingDaysBetween('2026-08-03', '2026-08-03', { halfDayStart: true })).toBe(0.5);
  });
  it('handles overnight shifts and breaks', () => {
    expect(shiftHours('22:00', '06:00', 1)).toEqual({ hours: 7, overnight: true, spanMinutes: 480 });
    expect(() => shiftHours('08:00', '09:00', 2)).toThrow();
  });
  it('computes proration and periods', () => {
    expect(prorationFactor('2026-08-03', '2026-08-14', '2026-08-10', null)).toBe(0.5);
    expect(periodEndFor('MONTHLY', '2026-01-31')).toBe('2026-02-27');
    expect(periodEndFor('MONTHLY', '2026-02-01')).toBe('2026-02-28');
    expect(periodEndFor('FORTNIGHTLY', '2026-01-05')).toBe('2026-01-18');
    expect(ageOn('1960-08-10', '2026-08-09')).toBe(65);
  });
});
