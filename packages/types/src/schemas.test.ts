import { describe, expect, it } from 'vitest';
import { blankable, moneyString, positiveMoney, rateFraction } from './common';
import { passwordSchema } from './auth';
import { employeeCreateSchema } from './hr';
import { mfaResetSchema, platformMfaResetSchema } from './admin';
import { paymentSchema, redeemCodeSchema, subscriptionCreateSchema } from './licensing';
import { optionalIsoDate } from './shared-fields';

const employee = (over: Record<string, unknown> = {}) => ({
  employeeNumber: 'EMP-0001',
  firstName: 'Omar',
  lastName: 'Clarke',
  hireDate: '2024-01-15',
  payFrequency: 'WEEKLY',
  payType: 'HOURLY',
  hourlyRate: '1250',
  ...over,
});

describe('shared validation contract (API and both web apps)', () => {
  it('money is a decimal string with at most 2 dp; rates are fractions between 0 and 1', () => {
    expect(moneyString.parse(1234.5)).toBe('1234.5');
    expect(moneyString.safeParse('12.345').success).toBe(false);
    expect(positiveMoney.safeParse('-1.00').success).toBe(false);
    expect(rateFraction.parse('0.025')).toBe('0.025');
    expect(rateFraction.safeParse('2.5').success).toBe(false);
  });

  it('blank optional form inputs become null instead of failing validation', () => {
    expect(blankable(positiveMoney).parse('')).toBeNull();
    expect(blankable(positiveMoney).parse(undefined)).toBeUndefined();
    expect(optionalIsoDate.parse('')).toBeNull();
    expect(optionalIsoDate.safeParse('15/01/2024').success).toBe(false);
  });

  it('passwords need 12+ characters with mixed case and a digit', () => {
    expect(passwordSchema.safeParse('short1A').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercase123').success).toBe(false);
    expect(passwordSchema.safeParse('Str0ng!Passw0rd').success).toBe(true);
  });

  it('employees: pay type needs its rate, and monthly employees must be salaried (TIM-002)', () => {
    expect(employeeCreateSchema.safeParse(employee()).success).toBe(true);
    expect(employeeCreateSchema.safeParse(employee({ hourlyRate: '' })).success).toBe(false);
    const monthlyHourly = employeeCreateSchema.safeParse(employee({ payFrequency: 'MONTHLY' }));
    expect(monthlyHourly.success).toBe(false);
    expect(JSON.stringify(monthlyHourly.error?.issues)).toMatch(/Monthly employees are salaried/);
    expect(employeeCreateSchema.safeParse(employee({ payFrequency: 'MONTHLY', payType: 'SALARY', salaryPerPeriod: '250000.00', hourlyRate: '' })).success).toBe(true);
    expect(employeeCreateSchema.safeParse(employee({ trn: '12345' })).success).toBe(false);
    expect(employeeCreateSchema.parse(employee({ trn: '' })).trn).toBeNull();
  });

  it('activation codes are normalised to upper case and must look like an issued code', () => {
    expect(redeemCodeSchema.parse({ code: '  qwik-abcd-efgh-ijkl-mnop ' }).code).toBe('QWIK-ABCD-EFGH-IJKL-MNOP');
    expect(redeemCodeSchema.safeParse({ code: 'short' }).success).toBe(false);
  });

  it('manual payments: positive amount, valid covered period', () => {
    const base = { customerId: 'c1', reference: 'BNS-123', paymentDate: '2026-01-05', amount: '15000.00', currency: 'jmd', method: 'BANK_TRANSFER' };
    expect(paymentSchema.parse(base).currency).toBe('JMD');
    expect(paymentSchema.safeParse({ ...base, amount: '0' }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...base, periodStart: '2026-02-01', periodEnd: '2026-01-01' }).success).toBe(false);
  });

  it('paid subscriptions need a verified payment or a reasoned override (LIC-005)', () => {
    expect(subscriptionCreateSchema.safeParse({ customerId: 'c', planId: 'p' }).success).toBe(false);
    expect(subscriptionCreateSchema.safeParse({ customerId: 'c', planId: 'p', override: true, overrideReason: 'too short' }).success).toBe(false);
    expect(subscriptionCreateSchema.safeParse({ customerId: 'c', planId: 'p', override: true, overrideReason: 'Pilot agreed by the board' }).success).toBe(true);
    expect(subscriptionCreateSchema.safeParse({ customerId: 'c', planId: 'p', paymentId: 'pay1' }).success).toBe(true);
  });

  it('MFA resets must record how identity was verified', () => {
    expect(mfaResetSchema.safeParse({ reason: 'ok' }).success).toBe(false);
    expect(platformMfaResetSchema.parse({ email: ' Admin@Example.COM ', reason: 'Video call with photo ID' }).email).toBe('admin@example.com');
  });
});
