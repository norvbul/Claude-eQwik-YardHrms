import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateMapping } from './mapping';
import * as N from './normalize';
import { parseCsv } from './read';
import { transform } from './transform';

const samples = path.resolve(__dirname, '../samples');
const mapping = () => validateMapping(JSON.parse(fs.readFileSync(path.join(samples, 'mapping.sample.json'), 'utf8')));

describe('normalisers', () => {
  it('reads legacy date formats with the configured day/month order', () => {
    expect(N.normDate('03/04/2024', 'DMY')).toEqual({ ok: true, value: '2024-04-03' });
    expect(N.normDate('03/04/2024', 'MDY')).toEqual({ ok: true, value: '2024-03-04' });
    expect(N.normDate('2024-04-03T05:00:00.000Z', 'DMY')).toEqual({ ok: true, value: '2024-04-03' });
    expect(N.normDate('45383', 'DMY')).toEqual({ ok: true, value: '2024-04-01' }); // spreadsheet serial
    expect(N.normDate('3 Apr 2024', 'MDY')).toEqual({ ok: true, value: '2024-04-03' });
    expect(N.normDate('31/02/2022', 'DMY').ok).toBe(false);
    expect(N.normDate('', 'DMY')).toEqual({ ok: true, value: null });
  });

  it('cleans money without floating-point drift and rejects negatives unless allowed', () => {
    expect(N.normMoney('$250,000.00')).toEqual({ ok: true, value: '250000.00' });
    expect(N.normMoney('JMD 1,234.565')).toEqual({ ok: true, value: '1234.57' });
    expect(N.normMoney('0.105')).toEqual({ ok: true, value: '0.11' });
    expect(N.normMoney('(1,200.00)').ok).toBe(false);
    expect(N.normMoney('(1,200.00)', { allowNegative: true })).toEqual({ ok: true, value: '-1200.00' });
    expect(N.normMoney('12abc').ok).toBe(false);
  });

  it('validates Jamaican identifiers, parishes and enums', () => {
    expect(N.normTrn('123-456-789')).toEqual({ ok: true, value: '123456789' });
    expect(N.normTrn('12345').ok).toBe(false);
    expect(N.normParish('saint james')).toEqual({ ok: true, value: 'St. James' });
    expect(N.normParish('Atlantis').ok).toBe(false);
    expect(N.normEnum('Bi-Weekly', N.PAY_FREQUENCIES, 'Pay frequency', N.PAY_FREQUENCY_SYNONYMS)).toEqual({ ok: true, value: 'FORTNIGHTLY' });
    expect(N.normName('ANDREA')).toBe('Andrea');
    expect(N.normName("o'brien-SMITH")).toBe("o'brien-SMITH");
  });

  it('parses quoted CSV with embedded commas, quotes and newlines', () => {
    expect(parseCsv('\uFEFFa,b\r\n"1,000","say ""hi""\nthere"\n')).toEqual([['a', 'b'], ['1,000', 'say "hi"\nthere']]);
  });
});

describe('mapping validation', () => {
  it('rejects unknown sources and fields and missing required columns', () => {
    expect(() => validateMapping({ dateOrder: 'DMY', sources: { staff: { file: 'x.csv', columns: {} } } })).toThrow(/Unknown source "staff"/);
    expect(() => validateMapping({ dateOrder: 'DMY', sources: { departments: { file: 'd.csv', columns: { legacyId: 'ID', nmae: 'Name' } } } })).toThrow(/columns.name is required[\s\S]*nmae is not a recognised field/);
    expect(() => validateMapping({ dateOrder: 'XYZ', sources: {} })).toThrow(/dateOrder/);
  });
});

describe('transform (synthetic sample export)', () => {
  it('produces a canonical dataset and flags every data-quality problem with row and reason', async () => {
    const { dataset, issues } = await transform(path.join(samples, 'export'), mapping());
    const errors = issues.filter((i) => i.severity === 'ERROR');
    const errorFor = (legacyId: string, field: string) => errors.find((e) => e.legacyId === legacyId && e.field === field);

    // Accepted employees, normalised
    expect(dataset.employees.map((e) => e.legacyId)).toEqual(['L-001', 'L-002', 'L-004']);
    const andrea = dataset.employees[0];
    expect(andrea).toMatchObject({ firstName: 'Andrea', lastName: 'Campbell', trn: '123456789', parish: 'St. Andrew', hireDate: '2019-01-03', payFrequency: 'MONTHLY', payType: 'SALARY', salaryPerPeriod: '250000.00', departmentLegacyId: 'D2', positionLegacyId: 'P2' });
    expect(dataset.employees[1]).toMatchObject({ payType: 'HOURLY', hourlyRate: '1250.00', positionLegacyId: 'P1', overtimeEligible: true, parish: 'St. James' });
    expect(dataset.employees[2]).toMatchObject({ payFrequency: 'FORTNIGHTLY', status: 'TERMINATED', terminationDate: '2023-03-31' });

    // Rejections with actionable reasons
    expect(errorFor('L-003', 'email')?.message).toMatch(/not a valid email/);
    expect(errorFor('L-005', 'trn')?.message).toMatch(/also used by legacy employee L-001/);
    expect(errorFor('L-005', 'payType')?.message).toMatch(/Monthly employees must be salaried/);
    expect(errorFor('L-006', 'department')?.message).toMatch(/D9/);
    expect(errorFor('L-006', 'hireDate')?.message).toMatch(/31\/02\/2022/);
    expect(errors.find((e) => e.source === 'leaveBalances' && e.legacyId === 'L-099')).toBeTruthy();

    // Reference data and codes
    expect(dataset.departments.map((d) => d.code)).toEqual(['OPERATIONS', 'FINANCE_ADMIN']);
    expect(dataset.positions[1].departmentLegacyId).toBe('D2'); // resolved by name
    expect(dataset.branches[1].parish).toBe('St. James');

    // Leave balances
    expect(dataset.leaveBalances).toEqual([
      { employeeLegacyId: 'L-001', leaveTypeCode: 'VAC', days: '12.50', asOfDate: '2023-12-31' },
      { employeeLegacyId: 'L-001', leaveTypeCode: 'SICK', days: '10.00', asOfDate: '2023-12-31' },
      { employeeLegacyId: 'L-002', leaveTypeCode: 'VAC', days: '4.00', asOfDate: '2023-12-31' },
    ]);

    // Payroll history: grouped per period; the row whose net does not reconcile is rejected
    expect(dataset.payrollHistory.map((p) => p.key)).toEqual(['WEEKLY:2024-01-01:2024-01-07', 'MONTHLY:2024-01-01:2024-01-31', 'WEEKLY:2024-01-08:2024-01-14']);
    expect(errors.find((e) => e.source === 'payrollHistory' && e.field === 'netPay')?.message).toMatch(/≠ net 49000.00/);
    const wk2 = dataset.payrollHistory[2].lines[0];
    expect(wk2).toMatchObject({ grossPay: '53750.00', netPay: '51457.50', otherDeductions: '250.00', overtimeHours: '2.00' });
    expect(wk2.deductions.find((d) => d.code === 'HEART')).toEqual({ code: 'HEART', employee: '0.00', employer: '1612.50' });

    expect(dataset.licences[0]).toMatchObject({ installationId: 'AKfycbx-demo-1', licenceType: 'PROFESSIONAL', expiresOn: '2024-12-31' });
    expect(dataset.sourceCounts).toMatchObject({ employees: 6, payrollHistory: 4 });
  });
});
