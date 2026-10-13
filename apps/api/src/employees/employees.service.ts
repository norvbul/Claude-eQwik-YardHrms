import { Injectable } from '@nestjs/common';
import { Prisma, type Employee } from '@prisma/client';
import { TenantPermissions as P } from '@yardhrms/authorization';
import type { EmployeeCreateInput, EmployeeUpdateInput } from '@yardhrms/types';
import { AuditService } from '../audit/audit.service';
import type { TenantAuth } from '../auth/auth-context';
import { CryptoService, last4, mask } from '../common/crypto.service';
import { badRequest, businessRule, conflict, notFound } from '../common/errors';
import { decOrNull, diff, isoDay, paginate, toDate } from '../common/util';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService, Tx } from '../prisma/prisma.service';

const LIST_INCLUDE = {
  department: { select: { id: true, name: true, code: true } },
  branch: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, name: true, code: true } },
  employmentType: { select: { id: true, name: true, code: true } },
  supervisor: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
} satisfies Prisma.EmployeeInclude;

type EmployeeWithRefs = Prisma.EmployeeGetPayload<{ include: typeof LIST_INCLUDE }>;

export interface EmployeeListFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'TERMINATED';
  departmentId?: string;
  payFrequency?: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';
  sort: 'employeeNumber' | 'lastName' | 'hireDate' | 'createdAt';
  order: 'asc' | 'desc';
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** SEC-007: identifiers and compensation are redacted unless the caller holds the relevant permission. */
  present(e: EmployeeWithRefs | Employee, auth: TenantAuth, opts: { reveal?: boolean } = {}) {
    const canSensitive = auth.permissions.has(P.EMPLOYEES_SENSITIVE_READ);
    const canComp = auth.permissions.has(P.COMPENSATION_READ) || auth.employeeId === e.id;
    const reveal = opts.reveal && canSensitive;
    const { trnEnc, nisEnc, nhtEnc, salaryPerPeriod, hourlyRate, standardHoursOverride, ...rest } = e as any;
    return {
      ...rest,
      dateOfBirth: isoDay(e.dateOfBirth),
      hireDate: isoDay(e.hireDate),
      probationEndDate: isoDay(e.probationEndDate),
      confirmationDate: isoDay(e.confirmationDate),
      terminationDate: isoDay(e.terminationDate),
      trn: reveal ? this.crypto.decryptNullable(trnEnc) : mask(e.trnLast4),
      nisNumber: reveal ? this.crypto.decryptNullable(nisEnc) : mask(e.nisLast4),
      nhtNumber: reveal ? this.crypto.decryptNullable(nhtEnc) : mask(e.nhtLast4),
      identifiersRevealed: !!reveal,
      salaryPerPeriod: canComp ? salaryPerPeriod?.toFixed(2) ?? null : null,
      hourlyRate: canComp ? hourlyRate?.toFixed(2) ?? null : null,
      standardHoursOverride: canComp ? standardHoursOverride?.toString() ?? null : null,
      compensationVisible: canComp,
      statutoryExemptions: (e.statutoryExemptions as string[] | null) ?? [],
    };
  }

  async list(auth: TenantAuth, f: EmployeeListFilters) {
    const where: Prisma.EmployeeWhereInput = { tenantId: auth.tenantId, deletedAt: null };
    if (f.status) where.status = f.status;
    if (f.departmentId) where.departmentId = f.departmentId;
    if (f.payFrequency) where.payFrequency = f.payFrequency;
    if (f.search) {
      const s = f.search.trim();
      where.OR = [{ firstName: { contains: s } }, { lastName: { contains: s } }, { employeeNumber: { contains: s } }, { email: { contains: s } }];
    }
    const orderBy: Prisma.EmployeeOrderByWithRelationInput[] =
      f.sort === 'lastName' ? [{ lastName: f.order }, { firstName: f.order }] : [{ [f.sort]: f.order } as Prisma.EmployeeOrderByWithRelationInput];
    const [total, items] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({ where, include: LIST_INCLUDE, orderBy, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    ]);
    return paginate(
      items.map((e) => this.present(e, auth)),
      total,
      f.page,
      f.pageSize,
    );
  }

  /** Searchable selector for delegated workflows (active employees only, minimal fields). */
  async options(auth: TenantAuth, search?: string, eligibleFor?: 'timesheet' | 'overtime') {
    const where: Prisma.EmployeeWhereInput = { tenantId: auth.tenantId, deletedAt: null, status: 'ACTIVE' };
    if (eligibleFor === 'timesheet') where.payFrequency = { in: ['WEEKLY', 'FORTNIGHTLY'] };
    if (eligibleFor === 'overtime') where.overtimeEligible = true;
    if (search) where.OR = [{ firstName: { contains: search } }, { lastName: { contains: search } }, { employeeNumber: { contains: search } }];
    const rows = await this.prisma.employee.findMany({
      where,
      select: { id: true, employeeNumber: true, firstName: true, lastName: true, payFrequency: true, overtimeEligible: true, department: { select: { name: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 50,
    });
    return rows;
  }

  async getOrThrow(tenantId: string, id: string, client: Tx | PrismaService = this.prisma) {
    const e = await client.employee.findFirst({ where: { id, tenantId, deletedAt: null }, include: LIST_INCLUDE });
    if (!e) throw notFound('Employee');
    return e;
  }

  private async validateRefs(tx: Tx, tenantId: string, d: Partial<EmployeeCreateInput>, selfId?: string) {
    const checks: [string | null | undefined, any, string][] = [
      [d.departmentId, tx.department, 'Department'],
      [d.branchId, tx.branch, 'Branch'],
      [d.positionId, tx.position, 'Position'],
      [d.employmentTypeId, tx.employmentType, 'Employment type'],
    ];
    for (const [id, delegate, label] of checks) {
      if (id) {
        const found = await delegate.findFirst({ where: { id, tenantId }, select: { id: true } });
        if (!found) throw badRequest(`${label} not found`);
      }
    }
    if (d.supervisorId) {
      if (d.supervisorId === selfId) throw badRequest('An employee cannot supervise themselves');
      const sup = await tx.employee.findFirst({ where: { id: d.supervisorId, tenantId, deletedAt: null }, select: { id: true } });
      if (!sup) throw badRequest('Supervisor not found');
    }
  }

  async nextEmployeeNumber(tx: Tx, tenantId: string): Promise<string> {
    for (let i = 0; i < 1000; i++) {
      const t = await tx.tenant.update({ where: { id: tenantId }, data: { nextEmployeeSeq: { increment: 1 } }, select: { nextEmployeeSeq: true } });
      const candidate = `EMP-${String(t.nextEmployeeSeq - 1).padStart(4, '0')}`;
      const exists = await tx.employee.findUnique({ where: { tenantId_employeeNumber: { tenantId, employeeNumber: candidate } }, select: { id: true } });
      if (!exists) return candidate;
    }
    throw conflict('Could not allocate an employee number');
  }

  private identifierData(d: { trn?: string | null; nisNumber?: string | null; nhtNumber?: string | null }) {
    const out: Record<string, string | null> = {};
    if (d.trn !== undefined) {
      out.trnEnc = this.crypto.encryptNullable(d.trn);
      out.trnLast4 = last4(d.trn);
    }
    if (d.nisNumber !== undefined) {
      out.nisEnc = this.crypto.encryptNullable(d.nisNumber);
      out.nisLast4 = last4(d.nisNumber);
    }
    if (d.nhtNumber !== undefined) {
      out.nhtEnc = this.crypto.encryptNullable(d.nhtNumber);
      out.nhtLast4 = last4(d.nhtNumber);
    }
    return out;
  }

  /** Creates an employee inside the caller's transaction (used by API and bulk import). */
  async createInTx(
    tx: Tx,
    auth: Pick<TenantAuth, 'tenantId' | 'user'>,
    d: EmployeeCreateInput,
    source: 'MANUAL' | 'IMPORT' | 'MIGRATION' = 'MANUAL',
    /** Legacy migration only: historical (terminated/inactive) employees do not consume active capacity. */
    legacy?: { status: 'ACTIVE' | 'INACTIVE' | 'TERMINATED'; terminationDate?: string | null; terminationReason?: string | null },
  ) {
    const status = legacy?.status ?? 'ACTIVE';
    if (status === 'ACTIVE') await this.entitlements.assertEmployeeCapacity(tx, auth.tenantId, 1);
    await this.validateRefs(tx, auth.tenantId, d);
    const dup = await tx.employee.findUnique({ where: { tenantId_employeeNumber: { tenantId: auth.tenantId, employeeNumber: d.employeeNumber } }, select: { id: true } });
    if (dup) throw conflict(`Employee number ${d.employeeNumber} is already in use`);
    const e = await tx.employee.create({
      data: {
        tenantId: auth.tenantId,
        employeeNumber: d.employeeNumber,
        firstName: d.firstName,
        middleName: d.middleName ?? null,
        lastName: d.lastName,
        preferredName: d.preferredName ?? null,
        email: d.email ?? null,
        phone: d.phone ?? null,
        mobile: d.mobile ?? null,
        dateOfBirth: toDate(d.dateOfBirth),
        gender: d.gender ?? null,
        addressLine1: d.addressLine1 ?? null,
        addressLine2: d.addressLine2 ?? null,
        city: d.city ?? null,
        parish: d.parish ?? null,
        ...this.identifierData(d),
        departmentId: d.departmentId ?? null,
        branchId: d.branchId ?? null,
        positionId: d.positionId ?? null,
        employmentTypeId: d.employmentTypeId ?? null,
        supervisorId: d.supervisorId ?? null,
        hireDate: toDate(d.hireDate),
        probationEndDate: toDate(d.probationEndDate),
        confirmationDate: toDate(d.confirmationDate),
        payFrequency: d.payFrequency,
        payType: d.payType,
        salaryPerPeriod: d.payType === 'SALARY' ? decOrNull(d.salaryPerPeriod) : null,
        hourlyRate: d.payType === 'HOURLY' ? decOrNull(d.hourlyRate) : null,
        standardHoursOverride: decOrNull(d.standardHoursOverride),
        overtimeEligible: d.overtimeEligible,
        statutoryExemptions: d.statutoryExemptions ?? [],
        status,
        terminationDate: toDate(legacy?.terminationDate ?? null),
        terminationReason: legacy?.terminationReason ?? null,
        source,
        createdById: auth.user.id,
      },
    });
    await tx.compensationHistory.create({
      data: {
        tenantId: auth.tenantId,
        employeeId: e.id,
        effectiveDate: e.hireDate,
        payFrequency: e.payFrequency,
        payType: e.payType,
        salaryPerPeriod: e.salaryPerPeriod,
        hourlyRate: e.hourlyRate,
        standardHoursOverride: e.standardHoursOverride,
        overtimeEligible: e.overtimeEligible,
        reason: 'Initial compensation at hire',
        changedById: auth.user.id,
      },
    });
    await tx.employmentHistory.create({ data: { tenantId: auth.tenantId, employeeId: e.id, eventType: 'HIRE', eventDate: e.hireDate, actorUserId: auth.user.id, details: { source } } });
    await this.audit.record(
      { tenantId: auth.tenantId, action: 'employee.created', entityType: 'Employee', entityId: e.id, subjectEmployeeId: e.id, after: { ...d, source }, actorUserId: auth.user.id },
      tx,
    );
    return e;
  }

  async create(auth: TenantAuth, d: EmployeeCreateInput) {
    const e = await this.prisma.tx((tx) => this.createInTx(tx, auth, d));
    return this.present(await this.getOrThrow(auth.tenantId, e.id), auth);
  }

  /** EMP-006: personal-data changes carry author, reason, timestamp and before/after metadata. */
  async updateInTx(tx: Tx, auth: Pick<TenantAuth, 'tenantId' | 'user'>, id: string, d: Omit<EmployeeUpdateInput, 'version'> & { version?: number }, reason?: string | null) {
    const current = await tx.employee.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
    if (!current) throw notFound('Employee');
    if (d.version !== undefined && d.version !== current.version) throw conflict('This employee was changed by someone else. Reload and try again.', { currentVersion: current.version });
    await this.validateRefs(tx, auth.tenantId, d as any, id);
    if (d.employeeNumber && d.employeeNumber !== current.employeeNumber) {
      const dup = await tx.employee.findUnique({ where: { tenantId_employeeNumber: { tenantId: auth.tenantId, employeeNumber: d.employeeNumber } }, select: { id: true } });
      if (dup) throw conflict(`Employee number ${d.employeeNumber} is already in use`);
    }
    const { version: _v, changeReason: _c, trn, nisNumber, nhtNumber, dateOfBirth, hireDate, probationEndDate, confirmationDate, ...plain } = d as any;
    const data: Prisma.EmployeeUncheckedUpdateInput = { ...plain, ...this.identifierData({ trn, nisNumber, nhtNumber }), version: { increment: 1 } };
    if (dateOfBirth !== undefined) data.dateOfBirth = toDate(dateOfBirth);
    if (hireDate !== undefined) data.hireDate = toDate(hireDate);
    if (probationEndDate !== undefined) data.probationEndDate = toDate(probationEndDate);
    if (confirmationDate !== undefined) data.confirmationDate = toDate(confirmationDate);
    const res = await tx.employee.updateMany({ where: { id, tenantId: auth.tenantId, version: current.version }, data: data as any });
    if (res.count !== 1) throw conflict('This employee was changed by someone else. Reload and try again.');
    const changes = diff(current as any, { ...plain, dateOfBirth: data.dateOfBirth, hireDate: data.hireDate });
    if (trn !== undefined) (changes.after as any).trn = '[changed]';
    if (nisNumber !== undefined) (changes.after as any).nisNumber = '[changed]';
    if (nhtNumber !== undefined) (changes.after as any).nhtNumber = '[changed]';
    for (const [field, type] of [
      ['departmentId', 'TRANSFER'],
      ['positionId', 'POSITION_CHANGE'],
      ['branchId', 'BRANCH_CHANGE'],
    ] as const) {
      if (field in changes.after) {
        await tx.employmentHistory.create({
          data: { tenantId: auth.tenantId, employeeId: id, eventType: type, eventDate: new Date(), actorUserId: auth.user.id, reason: reason ?? null, details: { from: changes.before[field], to: changes.after[field] } },
        });
      }
    }
    await this.audit.record(
      { tenantId: auth.tenantId, action: 'employee.updated', entityType: 'Employee', entityId: id, subjectEmployeeId: id, before: changes.before, after: changes.after, reason: reason ?? null, actorUserId: auth.user.id },
      tx,
    );
    return current;
  }

  async update(auth: TenantAuth, id: string, d: EmployeeUpdateInput) {
    await this.prisma.tx((tx) => this.updateInTx(tx, auth, id, d, d.changeReason));
    return this.present(await this.getOrThrow(auth.tenantId, id), auth);
  }

  async changeCompensation(
    auth: TenantAuth,
    id: string,
    d: { effectiveDate: string; payFrequency: any; payType: any; salaryPerPeriod?: string | null; hourlyRate?: string | null; standardHoursOverride?: string | null; overtimeEligible: boolean; reason: string },
  ) {
    await this.prisma.tx(async (tx) => {
      const e = await tx.employee.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!e) throw notFound('Employee');
      if (d.payFrequency === 'MONTHLY' && e.payFrequency !== 'MONTHLY') {
        const pending = await tx.timesheet.count({ where: { tenantId: auth.tenantId, employeeId: id, status: 'PENDING' } });
        if (pending) throw businessRule(`Resolve ${pending} pending timesheet(s) before moving this employee to monthly pay (monthly employees do not submit regular timesheets)`);
      }
      const before = { payFrequency: e.payFrequency, payType: e.payType, salaryPerPeriod: e.salaryPerPeriod, hourlyRate: e.hourlyRate, standardHoursOverride: e.standardHoursOverride, overtimeEligible: e.overtimeEligible };
      const after = {
        payFrequency: d.payFrequency,
        payType: d.payType,
        salaryPerPeriod: d.payType === 'SALARY' ? decOrNull(d.salaryPerPeriod) : null,
        hourlyRate: d.payType === 'HOURLY' ? decOrNull(d.hourlyRate) : null,
        standardHoursOverride: decOrNull(d.standardHoursOverride),
        overtimeEligible: d.overtimeEligible,
      };
      await tx.employee.update({ where: { id }, data: { ...after, version: { increment: 1 } } });
      await tx.compensationHistory.create({ data: { tenantId: auth.tenantId, employeeId: id, effectiveDate: toDate(d.effectiveDate), ...after, reason: d.reason, changedById: auth.user.id } });
      await tx.employmentHistory.create({ data: { tenantId: auth.tenantId, employeeId: id, eventType: 'COMPENSATION_CHANGE', eventDate: toDate(d.effectiveDate), reason: d.reason, actorUserId: auth.user.id } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'employee.compensation_changed', entityType: 'Employee', entityId: id, subjectEmployeeId: id, before, after, reason: d.reason }, tx);
    });
    return this.present(await this.getOrThrow(auth.tenantId, id), auth);
  }

  async setStatus(auth: TenantAuth, id: string, action: 'deactivate' | 'reactivate', reason: string, effectiveDate?: string, terminate = false) {
    await this.prisma.tx(async (tx) => {
      const e = await tx.employee.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!e) throw notFound('Employee');
      if (action === 'deactivate') {
        if (e.status !== 'ACTIVE') throw businessRule('Employee is not active');
        const to = terminate ? 'TERMINATED' : 'INACTIVE';
        await tx.employee.update({
          where: { id },
          data: { status: to, terminationDate: terminate ? toDate(effectiveDate ?? new Date().toISOString().slice(0, 10)) : e.terminationDate, terminationReason: terminate ? reason : e.terminationReason, version: { increment: 1 } },
        });
        await tx.employmentHistory.create({ data: { tenantId: auth.tenantId, employeeId: id, eventType: terminate ? 'TERMINATION' : 'DEACTIVATION', eventDate: toDate(effectiveDate ?? new Date().toISOString().slice(0, 10)), reason, actorUserId: auth.user.id } });
        await this.audit.record({ tenantId: auth.tenantId, action: terminate ? 'employee.terminated' : 'employee.deactivated', entityType: 'Employee', entityId: id, subjectEmployeeId: id, before: { status: e.status }, after: { status: to }, reason }, tx);
      } else {
        if (e.status === 'ACTIVE') throw businessRule('Employee is already active');
        await this.entitlements.assertEmployeeCapacity(tx, auth.tenantId, 1); // EMP-004: reactivations consume capacity
        await tx.employee.update({ where: { id }, data: { status: 'ACTIVE', terminationDate: null, terminationReason: null, version: { increment: 1 } } });
        await tx.employmentHistory.create({ data: { tenantId: auth.tenantId, employeeId: id, eventType: 'REACTIVATION', eventDate: new Date(), reason, actorUserId: auth.user.id } });
        await this.audit.record({ tenantId: auth.tenantId, action: 'employee.reactivated', entityType: 'Employee', entityId: id, subjectEmployeeId: id, before: { status: e.status }, after: { status: 'ACTIVE' }, reason }, tx);
      }
    });
    return this.present(await this.getOrThrow(auth.tenantId, id), auth);
  }

  /** Soft delete only — historical payroll, leave and audit records are preserved (PRD §6). */
  async softDelete(auth: TenantAuth, id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      const e = await tx.employee.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!e) throw notFound('Employee');
      await tx.employee.update({ where: { id }, data: { deletedAt: new Date(), status: e.status === 'ACTIVE' ? 'INACTIVE' : e.status } });
      await tx.tenantMembership.updateMany({ where: { tenantId: auth.tenantId, employeeId: id }, data: { employeeId: null } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'employee.deleted', entityType: 'Employee', entityId: id, subjectEmployeeId: id, reason }, tx);
    });
    return { deleted: true };
  }
}
