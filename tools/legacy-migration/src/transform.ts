import { readSheet, project } from './read';
import type { MigrationMapping, SourceKind } from './mapping';
import * as N from './normalize';

export interface Issue {
  source: SourceKind;
  row: number; // 1-based data row (header excluded); 0 = whole source
  legacyId: string;
  field: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface CanonicalRef { legacyId: string; code: string; name: string }
export interface CanonicalPosition extends CanonicalRef { departmentLegacyId: string | null }
export interface CanonicalBranch extends CanonicalRef { parish: string | null; address: string | null }
export interface CanonicalDepartment extends CanonicalRef { costCenter: string | null }

export interface CanonicalEmployee {
  legacyId: string;
  employeeNumber: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: (typeof N.GENDERS)[number] | null;
  addressLine1: string | null;
  city: string | null;
  parish: string | null;
  trn: string | null;
  nisNumber: string | null;
  nhtNumber: string | null;
  departmentLegacyId: string | null;
  branchLegacyId: string | null;
  positionLegacyId: string | null;
  hireDate: string;
  payFrequency: (typeof N.PAY_FREQUENCIES)[number];
  payType: (typeof N.PAY_TYPES)[number];
  salaryPerPeriod: string | null;
  hourlyRate: string | null;
  overtimeEligible: boolean;
  status: (typeof N.EMPLOYEE_STATUSES)[number];
  terminationDate: string | null;
  terminationReason: string | null;
}

export interface CanonicalLeaveBalance { employeeLegacyId: string; leaveTypeCode: string; days: string; asOfDate: string }

export interface CanonicalPayLine {
  employeeLegacyId: string;
  grossPay: string;
  netPay: string;
  deductions: { code: string; employee: string; employer: string }[];
  otherDeductions: string;
  regularHours: string;
  overtimeHours: string;
}
export interface CanonicalPayPeriod {
  key: string;
  frequency: (typeof N.PAY_FREQUENCIES)[number];
  periodStart: string;
  periodEnd: string;
  payDate: string;
  lines: CanonicalPayLine[];
}
export interface CanonicalLicence { installationId: string | null; companyName: string; email: string | null; licenceType: string | null; expiresOn: string | null; status: string | null }

export interface CanonicalDataset {
  generatedAt: string;
  mappingDateOrder: string;
  departments: CanonicalDepartment[];
  branches: CanonicalBranch[];
  positions: CanonicalPosition[];
  employees: CanonicalEmployee[];
  leaveBalances: CanonicalLeaveBalance[];
  payrollHistory: CanonicalPayPeriod[];
  licences: CanonicalLicence[];
  /** Raw source row counts, used by reconciliation. */
  sourceCounts: Partial<Record<SourceKind, number>>;
}

export interface TransformResult { dataset: CanonicalDataset; issues: Issue[] }

type Rec = Record<string, string>;
const STATUTORY = [
  ['NIS', 'nis', 'employerNis'],
  ['NHT', 'nht', 'employerNht'],
  ['EDTAX', 'edtax', 'employerEdtax'],
  ['PAYE', 'paye', null],
  ['HEART', null, 'heart'],
] as const;

/**
 * Turns the raw legacy export into a validated canonical dataset. Pure apart from reading the files:
 * it never touches the database, so it can be run (and re-run) safely while reviewing data quality.
 */
export async function transform(exportDir: string, mapping: MigrationMapping): Promise<TransformResult> {
  const issues: Issue[] = [];
  const counts: Partial<Record<SourceKind, number>> = {};
  const load = async (kind: SourceKind): Promise<Rec[]> => {
    const src = mapping.sources[kind];
    if (!src) return [];
    const data = await readSheet(exportDir, src);
    const { records, missingColumns } = project(data, src);
    for (const c of missingColumns) issues.push({ source: kind, row: 0, legacyId: '', field: c, severity: 'ERROR', message: `Column not found in ${src.file}: ${c}` });
    counts[kind] = records.length;
    return records;
  };
  const err = (source: SourceKind, row: number, legacyId: string, field: string, message: string) => issues.push({ source, row, legacyId, field, severity: 'ERROR', message });
  const warn = (source: SourceKind, row: number, legacyId: string, field: string, message: string) => issues.push({ source, row, legacyId, field, severity: 'WARNING', message });
  /** Applies a normaliser and records an issue on failure. */
  const take = <T>(source: SourceKind, row: number, id: string, field: string, r: N.Norm<T>): T | null => {
    if (r.ok) return r.value;
    err(source, row, id, field, r.error);
    return null;
  };

  // ── Reference data ────────────────────────────────────────────────────────
  const refs = <T extends CanonicalRef>(kind: 'departments' | 'branches' | 'positions', rows: Rec[], extra: (r: Rec, i: number, id: string) => Omit<T, keyof CanonicalRef>): T[] => {
    const out: T[] = [];
    const codes = new Set<string>();
    const ids = new Set<string>();
    rows.forEach((r, idx) => {
      const i = idx + 1;
      const id = r.legacyId?.trim();
      if (!id) return err(kind, i, '', 'legacyId', 'Legacy ID is blank');
      if (ids.has(id)) return warn(kind, i, id, 'legacyId', 'Duplicate legacy ID; the first occurrence is kept');
      ids.add(id);
      const name = r.name?.trim();
      if (!name) return err(kind, i, id, 'name', 'Name is blank');
      let code = N.normCode(r.code || name);
      if (!code) return err(kind, i, id, 'code', 'Could not derive a code');
      for (let n = 2; codes.has(code); n++) code = `${N.normCode(r.code || name).slice(0, 27)}_${n}`;
      codes.add(code);
      out.push({ legacyId: id, code, name: name.slice(0, 120), ...extra(r, i, id) } as T);
    });
    return out;
  };
  const departments = refs<CanonicalDepartment>('departments', await load('departments'), (r) => ({ costCenter: r.costCenter?.trim() || null }));
  const branches = refs<CanonicalBranch>('branches', await load('branches'), (r, i, id) => ({
    parish: take('branches', i, id, 'parish', N.normParish(r.parish ?? '')),
    address: r.address?.trim() || null,
  }));
  const resolver = (list: CanonicalRef[]) => {
    const by = new Map<string, string>();
    for (const x of list) for (const k of [x.legacyId, x.code, x.name]) by.set(k.trim().toLowerCase(), x.legacyId);
    return (v: string) => (v.trim() ? (by.get(v.trim().toLowerCase()) ?? undefined) : null);
  };
  const deptOf = resolver(departments);
  const positions = refs<CanonicalPosition>('positions', await load('positions'), (r, i, id) => {
    const d = deptOf(r.department ?? '');
    if (d === undefined) warn('positions', i, id, 'department', `Department "${r.department}" not found; position will have no department`);
    return { departmentLegacyId: d ?? null };
  });
  const branchOf = resolver(branches);
  const positionOf = resolver(positions);

  // ── Employees ─────────────────────────────────────────────────────────────
  const employees: CanonicalEmployee[] = [];
  const seen = { ids: new Set<string>(), numbers: new Set<string>(), trns: new Map<string, string>(), nameDob: new Map<string, string>() };
  (await load('employees')).forEach((r, idx) => {
    const i = idx + 1;
    const S = 'employees' as const;
    const id = r.legacyId?.trim();
    if (!id) return err(S, i, '', 'legacyId', 'Legacy ID is blank');
    if (seen.ids.has(id)) return err(S, i, id, 'legacyId', 'Duplicate legacy employee ID (deduplicate in the source before migrating)');
    seen.ids.add(id);
    const before = issues.length;
    const firstName = N.normName(r.firstName ?? '');
    const lastName = N.normName(r.lastName ?? '');
    if (!firstName) err(S, i, id, 'firstName', 'First name is blank');
    if (!lastName) err(S, i, id, 'lastName', 'Last name is blank');
    const hireDate = take(S, i, id, 'hireDate', N.normDate(r.hireDate ?? '', mapping.dateOrder));
    if (!hireDate && r.hireDate?.trim() === '') err(S, i, id, 'hireDate', 'Hire date is blank');
    const payFrequency = take(S, i, id, 'payFrequency', N.normEnum(r.payFrequency ?? '', N.PAY_FREQUENCIES, 'Pay frequency', N.PAY_FREQUENCY_SYNONYMS));
    if (!payFrequency && !r.payFrequency?.trim()) err(S, i, id, 'payFrequency', 'Pay frequency is blank');
    const payType = take(S, i, id, 'payType', N.normEnum(r.payType ?? '', N.PAY_TYPES, 'Pay type', N.PAY_TYPE_SYNONYMS));
    if (!payType && !r.payType?.trim()) err(S, i, id, 'payType', 'Pay type is blank');
    const salary = take(S, i, id, 'salaryPerPeriod', N.normMoney(r.salaryPerPeriod ?? ''));
    const hourly = take(S, i, id, 'hourlyRate', N.normMoney(r.hourlyRate ?? ''));
    if (payType === 'SALARY' && !salary) err(S, i, id, 'salaryPerPeriod', 'Salaried employees need a salary per pay period');
    if (payType === 'HOURLY' && !hourly) err(S, i, id, 'hourlyRate', 'Hourly employees need an hourly rate');
    if (payType === 'HOURLY' && payFrequency === 'MONTHLY') err(S, i, id, 'payType', 'Monthly employees must be salaried (they do not submit regular timesheets); correct the source record');
    const trn = take(S, i, id, 'trn', N.normTrn(r.trn ?? ''));
    if (trn) {
      const other = seen.trns.get(trn);
      if (other) err(S, i, id, 'trn', `TRN is also used by legacy employee ${other} (possible duplicate person)`);
      else seen.trns.set(trn, id);
    }
    const dob = take(S, i, id, 'dateOfBirth', N.normDate(r.dateOfBirth ?? '', mapping.dateOrder));
    if (firstName && lastName && dob) {
      const k = `${firstName.toLowerCase()}|${lastName.toLowerCase()}|${dob}`;
      const other = seen.nameDob.get(k);
      if (other) warn(S, i, id, 'name', `Same name and date of birth as legacy employee ${other}; confirm these are different people`);
      else seen.nameDob.set(k, id);
    }
    let employeeNumber: string | null = r.employeeNumber?.trim().toUpperCase() || null;
    if (employeeNumber && !/^[A-Z0-9-]{1,30}$/.test(employeeNumber)) {
      warn(S, i, id, 'employeeNumber', `Employee number "${employeeNumber}" is not usable; a new number will be allocated`);
      employeeNumber = null;
    }
    if (employeeNumber && seen.numbers.has(employeeNumber)) {
      warn(S, i, id, 'employeeNumber', `Employee number ${employeeNumber} is duplicated; a new number will be allocated`);
      employeeNumber = null;
    }
    if (employeeNumber) seen.numbers.add(employeeNumber);
    const dep = deptOf(r.department ?? '');
    if (dep === undefined) err(S, i, id, 'department', `Department "${r.department}" not found in the departments source`);
    const br = branchOf(r.branch ?? '');
    if (br === undefined) err(S, i, id, 'branch', `Branch "${r.branch}" not found in the branches source`);
    const pos = positionOf(r.position ?? '');
    if (pos === undefined) err(S, i, id, 'position', `Position "${r.position}" not found in the positions source`);
    const status = take(S, i, id, 'status', N.normEnum(r.status ?? '', N.EMPLOYEE_STATUSES, 'Status', N.STATUS_SYNONYMS)) ?? 'ACTIVE';
    const terminationDate = take(S, i, id, 'terminationDate', N.normDate(r.terminationDate ?? '', mapping.dateOrder));
    if (status === 'TERMINATED' && !terminationDate) err(S, i, id, 'terminationDate', 'Terminated employees need a termination date');
    if (terminationDate && hireDate && terminationDate < hireDate) err(S, i, id, 'terminationDate', 'Termination date is before the hire date');
    const email = take(S, i, id, 'email', N.normEmail(r.email ?? ''));
    const gender = take(S, i, id, 'gender', N.normEnum(r.gender ?? '', N.GENDERS, 'Gender', N.GENDER_SYNONYMS));
    const parish = take(S, i, id, 'parish', N.normParish(r.parish ?? ''));
    const nis = take(S, i, id, 'nisNumber', N.normIdentifier(r.nisNumber ?? '', 'NIS number'));
    const nht = take(S, i, id, 'nhtNumber', N.normIdentifier(r.nhtNumber ?? '', 'NHT number'));
    const ot = take(S, i, id, 'overtimeEligible', N.normBool(r.overtimeEligible ?? ''));
    if (issues.slice(before).some((x) => x.severity === 'ERROR')) return;
    employees.push({
      legacyId: id,
      employeeNumber,
      firstName,
      middleName: N.normName(r.middleName ?? '') || null,
      lastName,
      email,
      phone: r.phone?.trim() || null,
      dateOfBirth: dob,
      gender,
      addressLine1: r.addressLine1?.trim() || null,
      city: r.city?.trim() || null,
      parish,
      trn,
      nisNumber: nis,
      nhtNumber: nht,
      departmentLegacyId: dep ?? null,
      branchLegacyId: br ?? null,
      positionLegacyId: pos ?? null,
      hireDate: hireDate!,
      payFrequency: payFrequency!,
      payType: payType!,
      salaryPerPeriod: payType === 'SALARY' ? salary : null,
      hourlyRate: payType === 'HOURLY' ? hourly : null,
      overtimeEligible: ot ?? false,
      status,
      terminationDate,
      terminationReason: r.terminationReason?.trim().slice(0, 255) || null,
    });
  });
  const employeeOf = (() => {
    const by = new Map<string, string>();
    for (const e of employees) {
      by.set(e.legacyId.toLowerCase(), e.legacyId);
      if (e.employeeNumber) by.set(e.employeeNumber.toLowerCase(), e.legacyId);
    }
    return (v: string) => by.get(v.trim().toLowerCase());
  })();

  // ── Leave opening balances ────────────────────────────────────────────────
  const leaveBalances: CanonicalLeaveBalance[] = [];
  const leaveKeys = new Set<string>();
  (await load('leaveBalances')).forEach((r, idx) => {
    const i = idx + 1;
    const S = 'leaveBalances' as const;
    const emp = employeeOf(r.employee ?? '');
    if (!emp) return err(S, i, r.employee ?? '', 'employee', `Employee "${r.employee}" was not migrated (missing or rejected)`);
    const code = N.normCode(r.leaveType ?? '');
    if (!code) return err(S, i, emp, 'leaveType', 'Leave type is blank');
    const days = take(S, i, emp, 'days', N.normDecimal(r.days ?? ''));
    const asOf = take(S, i, emp, 'asOfDate', N.normDate(r.asOfDate ?? '', mapping.dateOrder));
    if (days === null || !asOf) return r.days?.trim() && r.asOfDate?.trim() ? undefined : err(S, i, emp, 'days', 'Days and as-of date are required');
    const key = `${emp}|${code}`;
    if (leaveKeys.has(key)) return err(S, i, emp, 'leaveType', `More than one opening balance for ${code}; keep only the latest`);
    leaveKeys.add(key);
    if (Number(days) < 0) warn(S, i, emp, 'days', 'Negative opening balance (leave taken in advance)');
    leaveBalances.push({ employeeLegacyId: emp, leaveTypeCode: code, days, asOfDate: asOf });
  });

  // ── Payroll history (approved historical results, reproduced not recalculated) ─
  const periods = new Map<string, CanonicalPayPeriod>();
  (await load('payrollHistory')).forEach((r, idx) => {
    const i = idx + 1;
    const S = 'payrollHistory' as const;
    const emp = employeeOf(r.employee ?? '');
    if (!emp) return err(S, i, r.employee ?? '', 'employee', `Employee "${r.employee}" was not migrated (missing or rejected)`);
    const before = issues.length;
    const frequency = take(S, i, emp, 'frequency', N.normEnum(r.frequency ?? '', N.PAY_FREQUENCIES, 'Frequency', N.PAY_FREQUENCY_SYNONYMS));
    const start = take(S, i, emp, 'periodStart', N.normDate(r.periodStart ?? '', mapping.dateOrder));
    const end = take(S, i, emp, 'periodEnd', N.normDate(r.periodEnd ?? '', mapping.dateOrder));
    const payDate = take(S, i, emp, 'payDate', N.normDate(r.payDate ?? '', mapping.dateOrder));
    const gross = take(S, i, emp, 'grossPay', N.normMoney(r.grossPay ?? ''));
    const net = take(S, i, emp, 'netPay', N.normMoney(r.netPay ?? '', { allowNegative: true }));
    if (!frequency || !start || !end || !payDate || gross === null || net === null) {
      if (issues.length === before) err(S, i, emp, 'period', 'Frequency, period dates, pay date, gross and net are required');
      return;
    }
    if (end < start) return err(S, i, emp, 'periodEnd', 'Period end is before period start');
    const deductions: CanonicalPayLine['deductions'] = [];
    let employeeTotal = 0n;
    const cents = (s: string) => BigInt(Math.round(Number(s) * 100));
    for (const [code, eeField, erField] of STATUTORY) {
      const ee = eeField ? take(S, i, emp, eeField, N.normMoney(r[eeField] ?? '')) : null;
      const er = erField ? take(S, i, emp, erField, N.normMoney(r[erField] ?? '')) : null;
      if (ee || er) deductions.push({ code, employee: ee ?? '0.00', employer: er ?? '0.00' });
      if (ee) employeeTotal += cents(ee);
    }
    const other = take(S, i, emp, 'otherDeductions', N.normMoney(r.otherDeductions ?? '')) ?? '0.00';
    employeeTotal += cents(other);
    if (issues.length > before) return;
    const diff = cents(gross) - employeeTotal - cents(net);
    if (diff > 1n || diff < -1n) {
      return err(S, i, emp, 'netPay', `Gross ${gross} − deductions ${(Number(employeeTotal) / 100).toFixed(2)} ≠ net ${net}; map every deduction column (or otherDeductions) before migrating`);
    }
    const key = `${frequency}:${start}:${end}`;
    const p = periods.get(key) ?? { key, frequency, periodStart: start, periodEnd: end, payDate, lines: [] };
    if (p.payDate !== payDate) warn(S, i, emp, 'payDate', `Pay date ${payDate} differs from ${p.payDate} for the same period; the first is used`);
    if (p.lines.some((l) => l.employeeLegacyId === emp)) return err(S, i, emp, 'employee', `Employee appears twice in period ${start}..${end}; combine the rows in the source first`);
    p.lines.push({
      employeeLegacyId: emp,
      grossPay: gross,
      netPay: net,
      deductions,
      otherDeductions: other,
      regularHours: take(S, i, emp, 'regularHours', N.normDecimal(r.regularHours ?? '')) ?? '0.00',
      overtimeHours: take(S, i, emp, 'overtimeHours', N.normDecimal(r.overtimeHours ?? '')) ?? '0.00',
    });
    periods.set(key, p);
  });

  // ── Legacy licences (reconciliation only; never auto-activates paid plans) ─
  const licences: CanonicalLicence[] = (await load('licences')).map((r, idx) => ({
    installationId: r.installationId?.trim() || null,
    companyName: r.companyName?.trim() ?? '',
    email: (N.normEmail(r.email ?? '') as { value?: string | null }).value ?? null,
    licenceType: r.licenceType?.trim() || null,
    expiresOn: take('licences', idx + 1, r.installationId ?? '', 'expiresOn', N.normDate(r.expiresOn ?? '', mapping.dateOrder)),
    status: r.status?.trim() || null,
  }));

  return {
    dataset: {
      generatedAt: new Date().toISOString(),
      mappingDateOrder: mapping.dateOrder,
      departments,
      branches,
      positions,
      employees,
      leaveBalances,
      payrollHistory: [...periods.values()].sort((a, b) => a.periodStart.localeCompare(b.periodStart)),
      licences,
      sourceCounts: counts,
    },
    issues,
  };
}

export function issuesToCsv(issues: Issue[]): string {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return ['source,row,legacy_id,field,severity,message', ...issues.map((x) => [x.source, x.row, x.legacyId, x.field, x.severity, x.message].map(esc).join(','))].join('\n') + '\n';
}
