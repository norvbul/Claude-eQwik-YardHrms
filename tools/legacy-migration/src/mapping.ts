/**
 * Mapping configuration: how legacy Google Sheets / ObjDB export columns map onto canonical fields.
 * One JSON file per customer migration, kept with the migration evidence (see README).
 */
export type DateOrder = 'YMD' | 'DMY' | 'MDY';

export interface SourceMapping {
  /** File inside the export directory (.csv or .xlsx). */
  file: string;
  /** Worksheet name for .xlsx files (defaults to the first visible sheet). */
  sheet?: string;
  /** canonical field -> legacy column header (case/space-insensitive match). */
  columns: Record<string, string>;
  /** Optional value translation tables per canonical field, e.g. { payFrequency: { "Bi-Weekly": "FORTNIGHTLY" } }. */
  values?: Record<string, Record<string, string>>;
}

export interface MigrationMapping {
  /** How ambiguous dates such as 03/04/2024 are read. Unambiguous ISO dates and spreadsheet serials always work. */
  dateOrder: DateOrder;
  sources: Partial<Record<SourceKind, SourceMapping>>;
}

export const SOURCE_KINDS = ['departments', 'branches', 'positions', 'employees', 'leaveBalances', 'payrollHistory', 'licences'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Canonical fields accepted per source (anything else in `columns` is rejected so typos are caught early). */
export const CANONICAL_FIELDS: Record<SourceKind, { required: string[]; optional: string[] }> = {
  departments: { required: ['legacyId', 'name'], optional: ['code', 'costCenter'] },
  branches: { required: ['legacyId', 'name'], optional: ['code', 'parish', 'address'] },
  positions: { required: ['legacyId', 'name'], optional: ['code', 'department'] },
  employees: {
    required: ['legacyId', 'firstName', 'lastName', 'hireDate', 'payFrequency', 'payType'],
    optional: [
      'employeeNumber', 'middleName', 'email', 'phone', 'dateOfBirth', 'gender', 'addressLine1', 'city', 'parish',
      'trn', 'nisNumber', 'nhtNumber', 'department', 'branch', 'position', 'salaryPerPeriod', 'hourlyRate',
      'overtimeEligible', 'status', 'terminationDate', 'terminationReason',
    ],
  },
  leaveBalances: { required: ['employee', 'leaveType', 'days', 'asOfDate'], optional: [] },
  payrollHistory: {
    required: ['employee', 'frequency', 'periodStart', 'periodEnd', 'payDate', 'grossPay', 'netPay'],
    optional: ['nis', 'nht', 'edtax', 'paye', 'otherDeductions', 'employerNis', 'employerNht', 'employerEdtax', 'heart', 'regularHours', 'overtimeHours'],
  },
  licences: { required: ['companyName'], optional: ['installationId', 'email', 'licenceType', 'expiresOn', 'status'] },
};

export function validateMapping(m: unknown): MigrationMapping {
  const errors: string[] = [];
  const mm = m as MigrationMapping;
  if (!mm || typeof mm !== 'object') throw new Error('Mapping must be a JSON object');
  if (!['YMD', 'DMY', 'MDY'].includes(mm.dateOrder)) errors.push('dateOrder must be one of YMD, DMY, MDY');
  if (!mm.sources || typeof mm.sources !== 'object') errors.push('sources must be an object');
  for (const [kind, src] of Object.entries(mm.sources ?? {})) {
    if (!(SOURCE_KINDS as readonly string[]).includes(kind)) {
      errors.push(`Unknown source "${kind}". Allowed: ${SOURCE_KINDS.join(', ')}`);
      continue;
    }
    const spec = CANONICAL_FIELDS[kind as SourceKind];
    if (!src?.file) errors.push(`sources.${kind}.file is required`);
    for (const f of spec.required) if (!src?.columns?.[f]) errors.push(`sources.${kind}.columns.${f} is required`);
    for (const f of Object.keys(src?.columns ?? {})) if (![...spec.required, ...spec.optional].includes(f)) errors.push(`sources.${kind}.columns.${f} is not a recognised field`);
  }
  if (errors.length) throw new Error(`Invalid mapping:\n  - ${errors.join('\n  - ')}`);
  return mm;
}
