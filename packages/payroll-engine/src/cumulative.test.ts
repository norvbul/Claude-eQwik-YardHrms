import { describe, expect, it } from 'vitest';
import { calculatePay, validateRuleSet } from './engine';
import { JAMAICA_REFERENCE_PACKS } from './reference/jamaica';
import type { ComponentYtd, EmployeePayInput, StatutoryComponentDef, StatutoryRuleSet } from './types';

const input = (over: Partial<EmployeePayInput> = {}): EmployeePayInput => ({
  employeeId: 'e1',
  payFrequency: 'MONTHLY',
  payType: 'SALARY',
  salaryPerPeriod: '300000',
  standardHoursPerPeriod: '173.33',
  workingDaysPerPeriod: '21.67',
  overtime: [],
  allowances: [],
  oneOffEarnings: [],
  leave: [],
  voluntaryDeductions: [],
  ageAtPeriodEnd: 40,
  ...over,
});
const rules = (components: StatutoryComponentDef[]): StatutoryRuleSet => ({ versionId: 'v', versionName: 'test', approved: true, components });
const line = (r: ReturnType<typeof calculatePay>, code: string) => r.statutory.find((s) => s.code === code)!;
/** Builds the YTD carried into the next period from a result (what the payroll service does from snapshots). */
const carry = (prev: ComponentYtd | undefined, r: ReturnType<typeof calculatePay>, code: string): ComponentYtd => {
  const l = line(r, code);
  const add = (a: string | undefined, b: string) => (Number(a ?? 0) + Number(b)).toFixed(4);
  return {
    base: add(prev?.base, l.base),
    employee: add(prev?.employee, l.employeeAmount),
    employer: add(prev?.employer, l.employerAmount),
    thresholdAllowance: add(prev?.thresholdAllowance, l.periodThreshold),
    ceilingAllowance: l.periodCeiling ? add(prev?.ceilingAllowance ?? undefined, l.periodCeiling) : null,
    yearFraction: (Number(prev?.yearFraction ?? 0) + Number(l.periodYearFraction)).toFixed(8),
  };
};

const PAYE = (method: 'PERIOD' | 'CUMULATIVE'): StatutoryComponentDef => ({
  code: 'PAYE',
  name: 'Income tax',
  sortOrder: 1,
  base: 'TAXABLE_GROSS',
  employeeRate: '0',
  employerRate: '0',
  annualThreshold: '1902360',
  brackets: [
    { upToAnnual: '6000000', rate: '0.25' },
    { upToAnnual: null, rate: '0.30' },
  ],
  bracketBasis: 'BEFORE_THRESHOLD',
  calculationMethod: method,
});

describe('bracket basis', () => {
  it('BEFORE_THRESHOLD applies the 30% band to the base above J$6M a year (J$500,000 a month)', () => {
    const r = calculatePay(input({ salaryPerPeriod: '800000' }), rules([PAYE('PERIOD')]));
    // 25% × (500,000 − 158,530) + 30% × (800,000 − 500,000)
    expect(line(r, 'PAYE').employeeAmount).toBe('175367.50');
  });
  it('AFTER_THRESHOLD measures bands on chargeable income instead', () => {
    const r = calculatePay(input({ salaryPerPeriod: '800000' }), rules([{ ...PAYE('PERIOD'), bracketBasis: 'AFTER_THRESHOLD' }]));
    // chargeable 641,470: 25% × 500,000 + 30% × 141,470
    expect(line(r, 'PAYE').employeeAmount).toBe('167441.00');
  });
});

describe('cumulative (year-to-date) calculation', () => {
  it('uses unused threshold from earlier low-pay periods', () => {
    const jan = calculatePay(input({ salaryPerPeriod: '100000' }), rules([PAYE('CUMULATIVE')]));
    expect(line(jan, 'PAYE').employeeAmount).toBe('0.00');
    const ytd = { PAYE: carry(undefined, jan, 'PAYE') };
    const feb = calculatePay(input({ salaryPerPeriod: '300000', ytd }), rules([PAYE('CUMULATIVE')]));
    // YTD 400,000 − 2 × 158,530 = 82,940 × 25%
    expect(line(feb, 'PAYE').employeeAmount).toBe('20735.00');
    expect(line(feb, 'PAYE').cumulative).toMatchObject({ base: '400000.00', threshold: '317060.00', priorEmployee: '0.00' });
    const periodBasis = calculatePay(input({ salaryPerPeriod: '300000' }), rules([PAYE('PERIOD')]));
    expect(line(periodBasis, 'PAYE').employeeAmount).toBe('35367.50');
  });

  it('never deducts a negative amount; over-deduction is reported and later periods catch up', () => {
    const jan = calculatePay(input({ salaryPerPeriod: '300000' }), rules([PAYE('CUMULATIVE')]));
    expect(line(jan, 'PAYE').employeeAmount).toBe('35367.50');
    let ytd: Record<string, ComponentYtd> = { PAYE: carry(undefined, jan, 'PAYE') };
    const feb = calculatePay(input({ salaryPerPeriod: '0', ytd }), rules([PAYE('CUMULATIVE')]));
    expect(line(feb, 'PAYE').employeeAmount).toBe('0.00');
    expect(feb.warnings.join(' ')).toMatch(/year-to-date deductions exceed the amount due by 35367.50/);
    ytd = { PAYE: carry(ytd.PAYE, feb, 'PAYE') };
    const mar = calculatePay(input({ salaryPerPeriod: '300000', ytd }), rules([PAYE('CUMULATIVE')]));
    // YTD 600,000 − 3 × 158,530 = 124,410 × 25% = 31,102.50 due; 35,367.50 already paid → 0
    expect(line(mar, 'PAYE').employeeAmount).toBe('0.00');
  });

  it('cumulative NIS ceiling lets a bonus month use ceiling unused earlier in the year', () => {
    const NIS: StatutoryComponentDef = { code: 'NIS', name: 'NIS', sortOrder: 1, base: 'GROSS', employeeRate: '0.03', employerRate: '0.03', annualCeiling: '5000000', calculationMethod: 'CUMULATIVE' };
    const jan = calculatePay(input({ salaryPerPeriod: '200000' }), rules([NIS]));
    const ytd = { NIS: carry(undefined, jan, 'NIS') };
    const feb = calculatePay(input({ salaryPerPeriod: '600000', ytd }), rules([NIS]));
    // ceiling YTD 833,333.33; base YTD 800,000 → all insurable: 3% × 600,000
    expect(line(feb, 'NIS').employeeAmount).toBe('18000.00');
    const periodOnly = calculatePay(input({ salaryPerPeriod: '600000' }), rules([{ ...NIS, calculationMethod: 'PERIOD' }]));
    expect(line(periodOnly, 'NIS').employeeAmount).toBe('12500.00'); // capped at 416,666.67
  });

  it('a supplemental run in an already-counted period gets no extra allowance', () => {
    const ytd = { PAYE: { base: '300000', employee: '35367.50', employer: '0', thresholdAllowance: '158530', ceilingAllowance: null, yearFraction: '0.08333333' } };
    const bonus = calculatePay(input({ salaryPerPeriod: '100000', ytd, periodYearFraction: '0' }), rules([PAYE('CUMULATIVE')]));
    expect(line(bonus, 'PAYE').employeeAmount).toBe('25000.00'); // entire bonus taxed at 25%
  });
});

describe('Jamaica reference pack (researched figures — verify before approval)', () => {
  const p2026 = JAMAICA_REFERENCE_PACKS.find((p) => p.key === 'JM-2026-04')!;
  const pack = rules(p2026.components);

  it('is structurally valid and carries sources', () => {
    expect(validateRuleSet(p2026.components)).toEqual([]);
    expect(p2026.sources.length).toBeGreaterThan(3);
    expect(JAMAICA_REFERENCE_PACKS.map((p) => [p.effectiveFrom, p.components.find((c) => c.code === 'PAYE')!.annualThreshold])).toEqual([
      ['2024-04-01', '1700088'],
      ['2025-04-01', '1799376'],
      ['2026-04-01', '1902360'],
    ]);
  });

  it('monthly J$300,000, age 40 (hand-calculated)', () => {
    const r = calculatePay(input(), pack);
    expect(Object.fromEntries(r.statutory.map((s) => [s.code, [s.employeeAmount, s.employerAmount]]))).toEqual({
      NIS: ['9000.00', '9000.00'],
      NHT: ['6000.00', '9000.00'],
      EDTAX: ['6547.50', '10185.00'], // 291,000 statutory income
      PAYE: ['33117.50', '0.00'], // (291,000 − 158,530) × 25%
      HEART: ['0.00', '9000.00'],
    });
    expect(r.netPay).toBe('245335.00');
  });

  it('monthly J$800,000: NIS capped at the J$5M ceiling, 30% band above J$6M', () => {
    const r = calculatePay(input({ salaryPerPeriod: '800000' }), pack);
    expect(line(r, 'NIS').employeeAmount).toBe('12500.00');
    // statutory income 787,500: 25% × (500,000 − 158,530) + 30% × 287,500
    expect(line(r, 'PAYE').employeeAmount).toBe('171617.50');
  });

  it('age 66: no NHT or Education Tax, NIS still due', () => {
    const r = calculatePay(input({ ageAtPeriodEnd: 66 }), pack);
    expect(line(r, 'NHT').exempt).toBe(true);
    expect(line(r, 'EDTAX').exempt).toBe(true);
    expect(line(r, 'NIS').employeeAmount).toBe('9000.00');
  });

  it('approved pension (pre-tax) reduces statutory income for Education Tax and PAYE', () => {
    const r = calculatePay(input({ voluntaryDeductions: [{ code: 'PEN', description: 'Approved pension 5%', amount: '15000', category: 'PENSION', preTax: true }] }), pack);
    expect(line(r, 'EDTAX').base).toBe('276000.00');
    expect(line(r, 'PAYE').employeeAmount).toBe('29367.50');
  });
});
