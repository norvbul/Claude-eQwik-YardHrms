import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, type ImportBatch, type ImportRow } from '@prisma/client';
import { TenantPermissions as P } from '@yardhrms/authorization';
import { shiftHours } from '@yardhrms/payroll-engine';
import { EMPLOYEE_IMPORT_COLUMNS, IMPORT_TEMPLATE_VERSION, TIMESHEET_IMPORT_COLUMNS, employeeCreateSchema, employeeUpdateSchema, isoDateField, hhmmField } from '@yardhrms/types';
import { AuditService } from '../audit/audit.service';
import type { TenantAuth } from '../auth/auth-context';
import { CryptoService } from '../common/crypto.service';
import { AppError, badRequest, businessRule, forbidden, invalidState, notFound } from '../common/errors';
import { paginate } from '../common/util';
import { EmployeesService } from '../employees/employees.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TimeService } from '../time/time.service';
import { autoMap, buildTemplate, parseSpreadsheet } from './spreadsheet';

type ImportKind = 'EMPLOYEES' | 'TIMESHEETS';
type RowError = { field?: string; message: string };
const CLEAR = '#CLEAR';

const COLUMNS = { EMPLOYEES: EMPLOYEE_IMPORT_COLUMNS, TIMESHEETS: TIMESHEET_IMPORT_COLUMNS } as const;

interface RefMaps {
  departments: Map<string, string>;
  branches: Map<string, string>;
  positions: Map<string, string>;
  employmentTypes: Map<string, string>;
  shiftTypes: Map<string, string>;
  employeesByNumber: Map<string, { id: string; payFrequency: string; status: string }>;
}

/**
 * Bulk import pipeline (IMP-001…005, AC-13): upload → parse & auto-map → preview validation →
 * queued execution in a retry-safe job. Each row commits in its own transaction together with its
 * outcome, so re-running a batch never replays rows already CREATED/UPDATED/REJECTED.
 */
@Injectable()
export class ImportsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly employees: EmployeesService,
    private readonly time: TimeService,
    private readonly entitlements: EntitlementsService,
  ) {}

  onModuleInit() {
    this.jobs.register('imports.process', (payload: { batchId: string }) => this.process(payload.batchId));
  }

  async template(kind: ImportKind): Promise<Buffer> {
    if (kind === 'EMPLOYEES') {
      return buildTemplate(
        EMPLOYEE_IMPORT_COLUMNS,
        'Employees',
        ['', 'Jane', '', 'Brown', 'jane.brown@example.com', '876-555-0100', '1990-04-12', 'FEMALE', '1 Main Street', 'Kingston', 'Kingston', '', '', '', 'FIN', 'HQ', '', 'FT', '2026-01-05', 'MONTHLY', 'SALARY', '150000.00', '', 'Y'],
        [
          `Template version ${IMPORT_TEMPLATE_VERSION}. Keep the header row. Dates use YYYY-MM-DD.`,
          'Leave Employee Number blank to CREATE a new employee (a number is assigned automatically).',
          'Enter an existing Employee Number to UPDATE that employee.',
          `Update merge rule: a BLANK cell leaves the existing value unchanged. Enter ${CLEAR} to clear an optional value.`,
          'Department/Branch/Position/Employment Type use the CODES configured in Company Settings.',
          'Monthly employees must be SALARY. New active employees count against your plan’s employee limit.',
          'Salary per Period is the amount for one pay period (e.g. the monthly amount for monthly employees).',
        ],
      );
    }
    return buildTemplate(
      TIMESHEET_IMPORT_COLUMNS,
      'Timesheets',
      ['EMP-0001', '2026-08-03', '', '08:00', '16:30', '0.5', 'Regular shift'],
      [
        `Template version ${IMPORT_TEMPLATE_VERSION}. Keep the header row. Dates use YYYY-MM-DD and times HH:mm (24-hour).`,
        'Only WEEKLY and FORTNIGHTLY employees may have regular timesheets. Rows for MONTHLY employees are rejected.',
        'An end time earlier than the start time is treated as an overnight shift.',
        'Imported timesheets start as PENDING and must be approved before payroll.',
      ],
    );
  }

  async upload(auth: TenantAuth, kind: ImportKind, file: Express.Multer.File) {
    if (kind === 'TIMESHEETS' && !auth.permissions.has(P.TIMESHEETS_SUBMIT_ANY)) throw forbidden('Timesheet imports require permission to submit timesheets for any employee');
    if (kind === 'EMPLOYEES' && !auth.permissions.has(P.EMPLOYEES_WRITE)) throw forbidden('Employee imports require permission to edit employees');
    this.storage.validateUpload(file, 'spreadsheet');
    const lower = file.originalname.toLowerCase();
    if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) throw badRequest('Upload an .xlsx or .csv file');
    let parsed: { headers: string[]; rows: string[][] };
    try {
      parsed = await parseSpreadsheet(file.buffer, file.originalname);
    } catch (e) {
      throw badRequest(`Could not read the spreadsheet: ${(e as Error).message}`);
    }
    if (!parsed.rows.length) throw badRequest('The file has a header row but no data rows');
    const sha = this.crypto.sha256(file.buffer);
    const key = this.storage.key(`tenants/${auth.tenantId}`, 'imports', file.originalname);
    await this.storage.put(key, file.buffer, lower.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const mapping = autoMap(parsed.headers, COLUMNS[kind]);
    const batch = await this.prisma.importBatch.create({
      data: { tenantId: auth.tenantId, type: kind, fileName: file.originalname.slice(0, 190), storageKey: key, sha256: sha, templateVersion: IMPORT_TEMPLATE_VERSION, headers: parsed.headers, mapping, totalRows: parsed.rows.length, createdById: auth.user.id },
    });
    // Store raw rows keyed by header (row numbers match the spreadsheet: header is row 1).
    const chunks = 500;
    for (let i = 0; i < parsed.rows.length; i += chunks) {
      await this.prisma.importRow.createMany({
        data: parsed.rows.slice(i, i + chunks).map((r, j) => ({
          tenantId: auth.tenantId,
          batchId: batch.id,
          rowNumber: i + j + 2,
          data: Object.fromEntries(parsed.headers.map((h, k) => [h || `Column ${k + 1}`, r[k] ?? ''])),
        })),
      });
    }
    await this.audit.record({ tenantId: auth.tenantId, action: 'import.uploaded', entityType: 'ImportBatch', entityId: batch.id, metadata: { kind, fileName: file.originalname, rows: parsed.rows.length, sha256: sha } });
    await this.validate(auth.tenantId, batch.id);
    return this.get(auth, batch.id);
  }

  async setMapping(auth: TenantAuth, id: string, mapping: Record<string, string>) {
    const batch = await this.batch(auth.tenantId, id);
    if (!['UPLOADED', 'VALIDATED'].includes(batch.status)) throw invalidState('Mapping can only change before execution');
    const headers = (batch.headers as string[]) ?? [];
    for (const [k, h] of Object.entries(mapping)) {
      if (!COLUMNS[batch.type].some((c) => c.key === k)) throw badRequest(`Unknown field ${k}`);
      if (h && !headers.includes(h)) throw badRequest(`Column "${h}" is not in the file`);
    }
    await this.prisma.importBatch.update({ where: { id }, data: { mapping: Object.fromEntries(Object.entries(mapping).filter(([, h]) => !!h)) } });
    await this.validate(auth.tenantId, id);
    return this.get(auth, id);
  }

  private async batch(tenantId: string, id: string) {
    const b = await this.prisma.importBatch.findFirst({ where: { id, tenantId } });
    if (!b) throw notFound('Import');
    return b;
  }

  private async refMaps(tenantId: string): Promise<RefMaps> {
    const [d, b, p, et, st, emps] = await Promise.all([
      this.prisma.department.findMany({ where: { tenantId } }),
      this.prisma.branch.findMany({ where: { tenantId } }),
      this.prisma.position.findMany({ where: { tenantId } }),
      this.prisma.employmentType.findMany({ where: { tenantId } }),
      this.prisma.shiftType.findMany({ where: { tenantId } }),
      this.prisma.employee.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, employeeNumber: true, payFrequency: true, status: true } }),
    ]);
    const m = (rows: { code: string; id: string }[]) => new Map(rows.map((r) => [r.code.toUpperCase(), r.id]));
    return {
      departments: m(d),
      branches: m(b),
      positions: m(p),
      employmentTypes: m(et),
      shiftTypes: m(st),
      employeesByNumber: new Map(emps.map((e) => [e.employeeNumber.toUpperCase(), { id: e.id, payFrequency: e.payFrequency, status: e.status }])),
    };
  }

  private mapRow(row: ImportRow, mapping: Record<string, string>): Record<string, string> {
    const data = row.data as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [key, header] of Object.entries(mapping)) out[key] = String(data[header] ?? '').trim();
    return out;
  }

  /** Normalizes and validates an employee row. Returns create/update payloads or errors. */
  private employeeRow(v: Record<string, string>, refs: RefMaps, seenNumbers: Set<string>, seenTrn: Set<string>) {
    const errors: RowError[] = [];
    const num = v.employeeNumber?.toUpperCase();
    const existing = num ? refs.employeesByNumber.get(num) : undefined;
    const mode: 'CREATE' | 'UPDATE' = num ? (existing ? 'UPDATE' : 'CREATE') : 'CREATE';
    if (num) {
      if (seenNumbers.has(num)) errors.push({ field: 'employeeNumber', message: `Duplicate employee number ${v.employeeNumber} in this file` });
      seenNumbers.add(num);
    }
    if (v.trn && v.trn !== CLEAR) {
      if (seenTrn.has(v.trn)) errors.push({ field: 'trn', message: 'Duplicate TRN in this file' });
      seenTrn.add(v.trn);
    }
    const ref = (field: 'department' | 'branch' | 'position' | 'employmentType', map: Map<string, string>) => {
      const code = v[field];
      if (!code) return undefined;
      if (code === CLEAR) return null;
      const id = map.get(code.toUpperCase());
      if (!id) errors.push({ field, message: `${field} code "${code}" not found` });
      return id;
    };
    const val = (k: string) => (v[k] === undefined || v[k] === '' ? undefined : v[k] === CLEAR ? null : v[k]);
    const payload: Record<string, unknown> = {
      employeeNumber: v.employeeNumber || undefined,
      firstName: val('firstName'),
      middleName: val('middleName'),
      lastName: val('lastName'),
      email: val('email'),
      phone: val('phone'),
      dateOfBirth: val('dateOfBirth'),
      gender: val('gender')?.toUpperCase?.(),
      addressLine1: val('addressLine1'),
      city: val('city'),
      parish: val('parish'),
      trn: val('trn')?.replace(/[^0-9]/g, ''),
      nisNumber: val('nisNumber'),
      nhtNumber: val('nhtNumber'),
      departmentId: ref('department', refs.departments),
      branchId: ref('branch', refs.branches),
      positionId: ref('position', refs.positions),
      employmentTypeId: ref('employmentType', refs.employmentTypes),
      hireDate: val('hireDate'),
      payFrequency: val('payFrequency')?.toUpperCase?.(),
      payType: val('payType')?.toUpperCase?.(),
      salaryPerPeriod: val('salaryPerPeriod')?.replace(/,/g, ''),
      hourlyRate: val('hourlyRate')?.replace(/,/g, ''),
      overtimeEligible: v.overtimeEligible ? /^(y|yes|true|1)$/i.test(v.overtimeEligible) : undefined,
    };
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

    if (mode === 'CREATE') {
      const parsed = employeeCreateSchema.safeParse({ ...payload, employeeNumber: payload.employeeNumber ?? 'PENDING-AUTO', overtimeEligible: payload.overtimeEligible ?? false, statutoryExemptions: [] });
      if (!parsed.success) for (const i of parsed.error.issues) errors.push({ field: i.path.join('.'), message: i.message });
      return { mode, errors, payload: parsed.success ? { ...parsed.data, employeeNumber: payload.employeeNumber as string | undefined } : null, existingId: undefined };
    }
    const { payFrequency, payType, salaryPerPeriod, hourlyRate, overtimeEligible, ...personal } = payload;
    const parsed = employeeUpdateSchema.safeParse({ ...personal, employeeNumber: undefined, version: 0 });
    if (!parsed.success) for (const i of parsed.error.issues) errors.push({ field: i.path.join('.'), message: i.message });
    const comp = { payFrequency, payType, salaryPerPeriod, hourlyRate, overtimeEligible };
    if (payFrequency && !['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'].includes(payFrequency as string)) errors.push({ field: 'payFrequency', message: 'Invalid pay frequency' });
    if (payType && !['SALARY', 'HOURLY'].includes(payType as string)) errors.push({ field: 'payType', message: 'Invalid pay type' });
    return { mode, errors, payload: parsed.success ? { personal: parsed.data, comp } : null, existingId: existing!.id };
  }

  private timesheetRow(v: Record<string, string>, refs: RefMaps, seen: Set<string>) {
    const errors: RowError[] = [];
    const emp = v.employeeNumber ? refs.employeesByNumber.get(v.employeeNumber.toUpperCase()) : undefined;
    if (!v.employeeNumber) errors.push({ field: 'employeeNumber', message: 'Employee number is required' });
    else if (!emp) errors.push({ field: 'employeeNumber', message: `Employee ${v.employeeNumber} not found` });
    else {
      if (emp.status !== 'ACTIVE') errors.push({ field: 'employeeNumber', message: 'Employee is not active' });
      if (emp.payFrequency === 'MONTHLY') errors.push({ field: 'employeeNumber', message: 'Monthly employees do not submit regular timesheets (AC-06)' });
    }
    if (!isoDateField.safeParse(v.workDate).success) errors.push({ field: 'workDate', message: 'Work date must be YYYY-MM-DD' });
    const st = v.startTime?.length === 4 ? `0${v.startTime}` : v.startTime;
    const et = v.endTime?.length === 4 ? `0${v.endTime}` : v.endTime;
    if (!hhmmField.safeParse(st).success) errors.push({ field: 'startTime', message: 'Start time must be HH:mm' });
    if (!hhmmField.safeParse(et).success) errors.push({ field: 'endTime', message: 'End time must be HH:mm' });
    const breakHours = v.breakHours ? Number(v.breakHours) : 0;
    if (Number.isNaN(breakHours) || breakHours < 0) errors.push({ field: 'breakHours', message: 'Break hours must be a non-negative number' });
    if (!errors.length) {
      try {
        const h = shiftHours(st, et, breakHours);
        if (h.hours <= 0) errors.push({ field: 'endTime', message: 'Regular hours must be greater than zero' });
      } catch (e) {
        errors.push({ field: 'breakHours', message: (e as Error).message });
      }
    }
    let shiftTypeId: string | null = null;
    if (v.shift) {
      shiftTypeId = refs.shiftTypes.get(v.shift.toUpperCase()) ?? null;
      if (!shiftTypeId) errors.push({ field: 'shift', message: `Shift code "${v.shift}" not found` });
    }
    const dupKey = `${v.employeeNumber?.toUpperCase()}|${v.workDate}|${st}`;
    if (seen.has(dupKey)) errors.push({ message: 'Duplicate employee/date/start time in this file' });
    seen.add(dupKey);
    return { errors, payload: { employeeId: emp?.id, workDate: v.workDate, startTime: st, endTime: et, breakHours: String(breakHours), shiftTypeId, comments: v.comments || null } };
  }

  /** Preview validation: marks each row VALID or REJECTED with actionable messages. */
  async validate(tenantId: string, batchId: string) {
    const batch = await this.batch(tenantId, batchId);
    const mapping = (batch.mapping as Record<string, string>) ?? {};
    const required = COLUMNS[batch.type].filter((c) => c.required && !mapping[c.key]);
    const refs = await this.refMaps(tenantId);
    const rows = await this.prisma.importRow.findMany({ where: { batchId }, orderBy: { rowNumber: 'asc' } });
    const seenA = new Set<string>();
    const seenB = new Set<string>();
    let valid = 0;
    for (const row of rows) {
      const v = this.mapRow(row, mapping);
      let errors: RowError[] = required.map((c) => ({ field: c.key, message: `Column for "${c.label}" is not mapped` }));
      if (!errors.length) errors = batch.type === 'EMPLOYEES' ? this.employeeRow(v, refs, seenA, seenB).errors : this.timesheetRow(v, refs, seenA).errors;
      if (!errors.length) valid++;
      await this.prisma.importRow.update({ where: { id: row.id }, data: { outcome: errors.length ? 'REJECTED' : 'VALID', errors: errors.length ? errors : Prisma.DbNull } });
    }
    await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'VALIDATED', validRows: valid, rejectedCount: rows.length - valid } });
  }

  async execute(auth: TenantAuth, id: string) {
    const batch = await this.batch(auth.tenantId, id);
    if (batch.status !== 'VALIDATED') throw invalidState(`Import is ${batch.status.toLowerCase()}`);
    if (!batch.validRows) throw businessRule('There are no valid rows to import');
    const res = await this.prisma.importBatch.updateMany({ where: { id, status: 'VALIDATED' }, data: { status: 'QUEUED' } });
    if (res.count !== 1) throw invalidState('Import already started');
    await this.jobs.enqueue('imports.process', { batchId: id }, { tenantId: auth.tenantId, dedupeKey: `import:${id}`, maxAttempts: 5 });
    await this.audit.record({ tenantId: auth.tenantId, action: 'import.queued', entityType: 'ImportBatch', entityId: id });
    return this.get(auth, id);
  }

  /** Worker: processes VALID rows; each row commits atomically with its outcome (idempotent on retry). */
  async process(batchId: string) {
    const batch = await this.prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status === 'COMPLETED') return { skipped: true };
    await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'PROCESSING' } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: batch.createdById } });
    const actor = { tenantId: batch.tenantId, user: { id: user.id, email: user.email, fullName: user.fullName } } as Pick<TenantAuth, 'tenantId' | 'user'>;
    const mapping = (batch.mapping as Record<string, string>) ?? {};
    const rows = await this.prisma.importRow.findMany({ where: { batchId, outcome: 'VALID' }, orderBy: { rowNumber: 'asc' } });
    for (const row of rows) {
      const refs = await this.refMaps(batch.tenantId); // refresh: earlier rows may have created employees
      const v = this.mapRow(row, mapping);
      try {
        await this.prisma.tx(async (tx) => {
          let outcome: 'CREATED' | 'UPDATED' = 'CREATED';
          let entityId: string;
          if (batch.type === 'EMPLOYEES') {
            const r = this.employeeRow(v, refs, new Set(), new Set());
            if (r.errors.length || !r.payload) throw new AppError('VALIDATION_FAILED' as any, r.errors.map((e) => e.message).join('; '), 400, r.errors);
            if (r.mode === 'CREATE') {
              const p = r.payload as any;
              const employeeNumber = p.employeeNumber || (await this.employees.nextEmployeeNumber(tx, batch.tenantId));
              const e = await this.employees.createInTx(tx, actor as any, { ...p, employeeNumber }, 'IMPORT');
              entityId = e.id;
            } else {
              const { personal, comp } = r.payload as any;
              const { version: _v, ...changes } = personal;
              await this.employees.updateInTx(tx, actor as any, r.existingId!, changes, `Bulk import ${batch.fileName} row ${row.rowNumber}`);
              const cur = await tx.employee.findUniqueOrThrow({ where: { id: r.existingId! } });
              const compChanged =
                (comp.payFrequency && comp.payFrequency !== cur.payFrequency) ||
                (comp.payType && comp.payType !== cur.payType) ||
                (comp.salaryPerPeriod && !cur.salaryPerPeriod?.equals(comp.salaryPerPeriod)) ||
                (comp.hourlyRate && !cur.hourlyRate?.equals(comp.hourlyRate)) ||
                (comp.overtimeEligible !== undefined && comp.overtimeEligible !== cur.overtimeEligible);
              if (compChanged) {
                const payType = comp.payType ?? cur.payType;
                const payFrequency = comp.payFrequency ?? cur.payFrequency;
                if (payType === 'HOURLY' && payFrequency === 'MONTHLY') throw businessRule('Monthly employees must be salaried');
                const after = {
                  payFrequency,
                  payType,
                  salaryPerPeriod: payType === 'SALARY' ? new Prisma.Decimal(comp.salaryPerPeriod ?? cur.salaryPerPeriod ?? 0) : null,
                  hourlyRate: payType === 'HOURLY' ? new Prisma.Decimal(comp.hourlyRate ?? cur.hourlyRate ?? 0) : null,
                  overtimeEligible: comp.overtimeEligible ?? cur.overtimeEligible,
                };
                if (after.payType === 'SALARY' && after.salaryPerPeriod!.lessThanOrEqualTo(0)) throw businessRule('Salary per period is required');
                if (after.payType === 'HOURLY' && after.hourlyRate!.lessThanOrEqualTo(0)) throw businessRule('Hourly rate is required');
                await tx.employee.update({ where: { id: cur.id }, data: { ...after, version: { increment: 1 } } });
                await tx.compensationHistory.create({ data: { tenantId: batch.tenantId, employeeId: cur.id, effectiveDate: new Date(), ...after, standardHoursOverride: cur.standardHoursOverride, reason: `Bulk import ${batch.fileName}`, changedById: user.id } });
                await this.audit.record({ tenantId: batch.tenantId, action: 'employee.compensation_changed', entityType: 'Employee', entityId: cur.id, subjectEmployeeId: cur.id, after, reason: `Bulk import row ${row.rowNumber}`, actorUserId: user.id }, tx);
              }
              outcome = 'UPDATED';
              entityId = r.existingId!;
            }
          } else {
            const r = this.timesheetRow(v, refs, new Set());
            if (r.errors.length) throw new AppError('VALIDATION_FAILED' as any, r.errors.map((e) => e.message).join('; '), 400, r.errors);
            const employee = await tx.employee.findFirstOrThrow({ where: { id: r.payload.employeeId!, tenantId: batch.tenantId } });
            const ts = await this.time.createTimesheetInTx(tx, actor as any, employee, r.payload as any, { delegated: true, source: 'IMPORT', importBatchId: batch.id });
            entityId = ts.id;
          }
          const claimed = await tx.importRow.updateMany({ where: { id: row.id, outcome: 'VALID' }, data: { outcome, entityId, processedAt: new Date(), errors: Prisma.DbNull } });
          if (claimed.count !== 1) throw new Error('ROW_ALREADY_PROCESSED');
        });
      } catch (e) {
        if ((e as Error).message === 'ROW_ALREADY_PROCESSED') continue;
        const err = e as any;
        const message = err?.response?.message ?? err?.message ?? 'Unknown error';
        await this.prisma.importRow.updateMany({ where: { id: row.id, outcome: 'VALID' }, data: { outcome: 'REJECTED', errors: [{ message }], processedAt: new Date() } });
      }
    }
    const counts = await this.prisma.importRow.groupBy({ by: ['outcome'], where: { batchId }, _count: true });
    const c = (o: string) => counts.find((x) => x.outcome === o)?._count ?? 0;
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'COMPLETED', createdCount: c('CREATED'), updatedCount: c('UPDATED'), rejectedCount: c('REJECTED'), skippedCount: c('SKIPPED'), completedAt: new Date() },
    });
    await this.audit.record({ tenantId: batch.tenantId, action: 'import.completed', entityType: 'ImportBatch', entityId: batchId, actorUserId: user.id, metadata: { created: c('CREATED'), updated: c('UPDATED'), rejected: c('REJECTED') } });
    return { created: c('CREATED'), updated: c('UPDATED'), rejected: c('REJECTED') };
  }

  async list(auth: TenantAuth, page = 1, pageSize = 20) {
    const where = { tenantId: auth.tenantId };
    const [total, items] = await Promise.all([
      this.prisma.importBatch.count({ where }),
      this.prisma.importBatch.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return paginate(items.map((b) => this.presentBatch(b)), total, page, pageSize);
  }

  private presentBatch(b: ImportBatch) {
    const { storageKey: _k, ...rest } = b;
    return { ...rest, columns: COLUMNS[b.type] };
  }

  async get(auth: TenantAuth, id: string, rowPage = 1, outcome?: string) {
    const b = await this.batch(auth.tenantId, id);
    const where: Prisma.ImportRowWhereInput = { batchId: id, outcome: outcome ? (outcome as any) : undefined };
    const [total, rows, counts] = await Promise.all([
      this.prisma.importRow.count({ where }),
      this.prisma.importRow.findMany({ where, orderBy: { rowNumber: 'asc' }, skip: (rowPage - 1) * 100, take: 100 }),
      this.prisma.importRow.groupBy({ by: ['outcome'], where: { batchId: id }, _count: true }),
    ]);
    return { batch: this.presentBatch(b), rows, rowTotal: total, rowPage, counts: Object.fromEntries(counts.map((c) => [c.outcome, c._count])) };
  }

  async errorsCsv(auth: TenantAuth, id: string): Promise<string> {
    await this.batch(auth.tenantId, id);
    const rows = await this.prisma.importRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: 'asc' } });
    const esc = (s: string) => {
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = ['Row,Outcome,Errors,Entity ID'];
    for (const r of rows) {
      const errs = ((r.errors as RowError[] | null) ?? []).map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' | ');
      lines.push([String(r.rowNumber), r.outcome, errs, r.entityId ?? ''].map(esc).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  async capacityPreview(auth: TenantAuth, id: string) {
    const b = await this.batch(auth.tenantId, id);
    if (b.type !== 'EMPLOYEES') return null;
    const ent = await this.entitlements.forTenant(auth.tenantId);
    const active = await this.entitlements.countActiveEmployees(this.prisma, auth.tenantId);
    const mapping = (b.mapping as Record<string, string>) ?? {};
    const refs = await this.refMaps(auth.tenantId);
    const rows = await this.prisma.importRow.findMany({ where: { batchId: id, outcome: 'VALID' } });
    const creates = rows.filter((r) => {
      const v = this.mapRow(r, mapping);
      return !v.employeeNumber || !refs.employeesByNumber.has(v.employeeNumber.toUpperCase());
    }).length;
    return { limit: ent.employeeLimit, active, creates, overBy: Math.max(0, active + creates - ent.employeeLimit) };
  }
}
