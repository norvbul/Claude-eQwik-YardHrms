import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addMonths, workingDaysBetween } from '@yardhrms/payroll-engine';
import type { LeaveRequestInput } from '@yardhrms/types';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import type { TenantAuth } from '../auth/auth-context';
import { badRequest, businessRule, conflict, forbidden, invalidState, notFound } from '../common/errors';
import { isoDay, paginate, toDate } from '../common/util';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { assertCanDecide, assertPeriodOpen, resolveSubject, scopeEmployeeFilter } from '../workflow/workflow-helpers';

const D = Prisma.Decimal;

export interface BalanceRow {
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  category: string;
  opening: string;
  accrued: string;
  used: string;
  adjusted: string;
  expired: string;
  balance: string;
  pending: string;
  available: string;
  tracked: boolean;
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async holidays(tenantId: string, from: Date, to: Date): Promise<string[]> {
    const rows = await this.prisma.publicHoliday.findMany({ where: { tenantId, date: { gte: from, lte: to } }, select: { date: true } });
    return rows.map((r) => isoDay(r.date)!);
  }

  async workingDays(tenantId: string, start: string, end: string, halfDayStart = false, halfDayEnd = false): Promise<number> {
    const holidays = await this.holidays(tenantId, toDate(start), toDate(end));
    return workingDaysBetween(start, end, { holidays, halfDayStart, halfDayEnd });
  }

  /** Effective policy: most specific (employment type) then latest effectiveFrom ≤ asOf. */
  async policyFor(client: Tx | PrismaService, tenantId: string, leaveTypeId: string, employmentTypeId: string | null, asOf: Date) {
    const policies = await client.leavePolicy.findMany({
      where: { tenantId, leaveTypeId, effectiveFrom: { lte: asOf }, OR: [{ employmentTypeId: null }, ...(employmentTypeId ? [{ employmentTypeId }] : [])] },
      orderBy: { effectiveFrom: 'desc' },
    });
    return policies.find((p) => p.employmentTypeId === employmentTypeId && employmentTypeId) ?? policies.find((p) => !p.employmentTypeId) ?? null;
  }

  async balances(tenantId: string, employeeId: string, client: Tx | PrismaService = this.prisma): Promise<BalanceRow[]> {
    const employee = await client.employee.findFirst({ where: { id: employeeId, tenantId } });
    if (!employee) throw notFound('Employee');
    const [types, ledger, pending] = await Promise.all([
      client.leaveType.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
      client.leaveLedgerEntry.groupBy({ by: ['leaveTypeId', 'entryType'], where: { tenantId, employeeId }, _sum: { days: true } }),
      client.leaveRequest.groupBy({ by: ['leaveTypeId'], where: { tenantId, employeeId, status: 'PENDING' }, _sum: { workingDays: true } }),
    ]);
    const out: BalanceRow[] = [];
    for (const t of types) {
      const sumOf = (types: string[]) => ledger.filter((l) => l.leaveTypeId === t.id && types.includes(l.entryType)).reduce((acc, l) => acc.plus(l._sum.days ?? 0), new D(0));
      const opening = sumOf(['OPENING']);
      const accrued = sumOf(['ACCRUAL']);
      const used = sumOf(['USAGE', 'REVERSAL']).negated();
      const adjusted = sumOf(['ADJUSTMENT', 'CARRY_FORWARD']);
      const expired = sumOf(['EXPIRY']).negated();
      const balance = opening.plus(accrued).minus(used).plus(adjusted).minus(expired);
      const pend = new D(pending.find((p) => p.leaveTypeId === t.id)?._sum.workingDays ?? 0);
      const policy = await this.policyFor(client, tenantId, t.id, employee.employmentTypeId, new Date());
      const hasLedger = ledger.some((l) => l.leaveTypeId === t.id);
      const tracked = t.category !== 'UNPAID' && (!!policy || hasLedger);
      if (!t.active && !hasLedger && pend.isZero()) continue;
      out.push({
        leaveTypeId: t.id,
        leaveTypeCode: t.code,
        leaveTypeName: t.name,
        category: t.category,
        opening: opening.toFixed(2),
        accrued: accrued.toFixed(2),
        used: used.toFixed(2),
        adjusted: adjusted.toFixed(2),
        expired: expired.toFixed(2),
        balance: balance.toFixed(2),
        pending: pend.toFixed(2),
        available: balance.minus(pend).toFixed(2),
        tracked,
      });
    }
    return out;
  }

  async list(auth: TenantAuth, q: { page: number; pageSize: number; status?: any; employeeId?: string; from?: string; to?: string; mine?: boolean }) {
    const employeeId = scopeEmployeeFilter(auth, 'leave', q.employeeId, q.mine);
    if (employeeId === null) return paginate([], 0, q.page, q.pageSize);
    const where: Prisma.LeaveRequestWhereInput = { tenantId: auth.tenantId };
    if (employeeId) where.employeeId = employeeId;
    if (q.status) where.status = q.status;
    if (q.from) where.endDate = { gte: toDate(q.from) };
    if (q.to) where.startDate = { lte: toDate(q.to) };
    const [total, rows] = await Promise.all([
      this.prisma.leaveRequest.count({ where }),
      this.prisma.leaveRequest.findMany({
        where,
        include: { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } }, leaveType: { select: { id: true, name: true, code: true, category: true } } },
        orderBy: [{ startDate: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const userIds = [...new Set(rows.flatMap((r) => [r.submittedByUserId, r.decidedByUserId].filter(Boolean) as string[]))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } });
    const name = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? null;
    return paginate(
      rows.map((r) => ({ ...r, startDate: isoDay(r.startDate), endDate: isoDay(r.endDate), submittedBy: name(r.submittedByUserId), decidedBy: name(r.decidedByUserId) })),
      total,
      q.page,
      q.pageSize,
    );
  }

  async get(auth: TenantAuth, id: string) {
    const r = await this.prisma.leaveRequest.findFirst({ where: { id, tenantId: auth.tenantId }, include: { approvals: { orderBy: { createdAt: 'asc' } }, employee: true, leaveType: true } });
    if (!r) throw notFound('Leave request');
    if (!auth.permissions.has('leave.read.any') && r.employeeId !== auth.employeeId && r.submittedByUserId !== auth.user.id) throw notFound('Leave request');
    return { ...r, startDate: isoDay(r.startDate), endDate: isoDay(r.endDate) };
  }

  /** LEA-002/003/006: records subject employee + actor; working days exclude weekends & public holidays. */
  async create(auth: TenantAuth, input: LeaveRequestInput) {
    return this.prisma.tx(async (tx) => {
      const { employee, delegated } = await resolveSubject(tx, auth, 'leave', input.employeeId);
      const type = await tx.leaveType.findFirst({ where: { id: input.leaveTypeId, tenantId: auth.tenantId, active: true } });
      if (!type) throw badRequest('Leave type not found');
      if (toDate(input.startDate) < employee.hireDate) throw businessRule('Leave cannot start before the employee’s hire date');
      const days = await this.workingDays(auth.tenantId, input.startDate, input.endDate, input.halfDayStart, input.halfDayEnd);
      if (days <= 0) throw businessRule('The selected dates contain no working days (weekends and public holidays are excluded)');
      await assertPeriodOpen(tx, auth.tenantId, employee.payFrequency, toDate(input.startDate), toDate(input.endDate));
      const overlap = await tx.leaveRequest.findFirst({
        where: { tenantId: auth.tenantId, employeeId: employee.id, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: toDate(input.endDate) }, endDate: { gte: toDate(input.startDate) } },
      });
      if (overlap) throw conflict(`Overlaps an existing ${overlap.status.toLowerCase()} leave request (${isoDay(overlap.startDate)} – ${isoDay(overlap.endDate)})`);
      if (type.category !== 'UNPAID') {
        const bal = (await this.balances(auth.tenantId, employee.id, tx)).find((b) => b.leaveTypeId === type.id);
        if (bal?.tracked && Number(bal.available) < days) {
          throw businessRule(`Insufficient ${type.name} balance: ${bal.available} day(s) available, ${days} requested`, { available: bal.available, requested: days });
        }
      }
      const req = await tx.leaveRequest.create({
        data: {
          tenantId: auth.tenantId,
          employeeId: employee.id,
          leaveTypeId: type.id,
          startDate: toDate(input.startDate),
          endDate: toDate(input.endDate),
          halfDayStart: input.halfDayStart,
          halfDayEnd: input.halfDayEnd,
          workingDays: new D(days),
          payPercent: type.payPercent,
          reason: input.reason ?? null,
          submittedByUserId: auth.user.id,
          delegated,
        },
      });
      await tx.leaveApproval.create({ data: { tenantId: auth.tenantId, leaveRequestId: req.id, action: delegated ? 'SUBMITTED_DELEGATED' : 'SUBMITTED', actorUserId: auth.user.id } });
      await this.audit.record(
        {
          tenantId: auth.tenantId,
          action: delegated ? 'leave.submitted_delegated' : 'leave.submitted',
          entityType: 'LeaveRequest',
          entityId: req.id,
          subjectEmployeeId: employee.id,
          after: { leaveType: type.code, startDate: input.startDate, endDate: input.endDate, workingDays: days },
        },
        tx,
      );
      await this.notifications.requestSubmitted(tx, { tenantId: auth.tenantId, actorUserId: auth.user.id, actorName: auth.user.fullName }, {
        kind: 'leave',
        approvePermission: 'leave.approve',
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        summary: `${type.name}, ${input.startDate}${input.endDate !== input.startDate ? ` to ${input.endDate}` : ''} (${days} working day${days === 1 ? '' : 's'})`,
        link: '/app/leave',
        id: req.id,
      });
      return { ...req, startDate: input.startDate, endDate: input.endDate };
    });
  }

  async decide(auth: TenantAuth, id: string, decision: 'APPROVE' | 'REJECT', comment?: string | null) {
    return this.prisma.tx(async (tx) => {
      const r = await tx.leaveRequest.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!r) throw notFound('Leave request');
      if (r.status !== 'PENDING') throw invalidState(`Request is already ${r.status.toLowerCase()}`);
      await assertCanDecide(tx, auth, 'leave', r);
      const employee = await tx.employee.findUniqueOrThrow({ where: { id: r.employeeId } });
      if (decision === 'APPROVE') await assertPeriodOpen(tx, auth.tenantId, employee.payFrequency, r.startDate, r.endDate);
      const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const res = await tx.leaveRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status, decidedByUserId: auth.user.id, decidedAt: new Date(), decisionComment: comment ?? null } });
      if (res.count !== 1) throw invalidState('Request was already decided');
      if (decision === 'APPROVE') {
        await tx.leaveLedgerEntry.create({
          data: { tenantId: auth.tenantId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, entryType: 'USAGE', days: r.workingDays.negated(), effectiveDate: r.startDate, leaveRequestId: r.id, reason: 'Approved leave', createdById: auth.user.id },
        });
      }
      await tx.leaveApproval.create({ data: { tenantId: auth.tenantId, leaveRequestId: r.id, action: status, actorUserId: auth.user.id, comment: comment ?? null } });
      await this.audit.record({ tenantId: auth.tenantId, action: `leave.${status.toLowerCase()}`, entityType: 'LeaveRequest', entityId: r.id, subjectEmployeeId: r.employeeId, before: { status: 'PENDING' }, after: { status }, reason: comment ?? null }, tx);
      await this.notifications.requestDecided(tx, { tenantId: auth.tenantId, actorUserId: auth.user.id, actorName: auth.user.fullName }, {
        kind: 'leave',
        employeeId: r.employeeId,
        submittedByUserId: r.submittedByUserId,
        status,
        summary: `Leave for ${employee.firstName} ${employee.lastName}, ${isoDay(r.startDate)}${isoDay(r.endDate) !== isoDay(r.startDate) ? ` to ${isoDay(r.endDate)}` : ''}`,
        comment,
        link: '/app/leave',
        id: r.id,
      });
      return { id, status };
    });
  }

  async cancel(auth: TenantAuth, id: string, comment?: string | null) {
    return this.prisma.tx(async (tx) => {
      const r = await tx.leaveRequest.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!r) throw notFound('Leave request');
      const own = r.employeeId === auth.employeeId || r.submittedByUserId === auth.user.id;
      if (r.status === 'PENDING') {
        if (!own && !auth.permissions.has('leave.approve')) throw forbidden();
      } else if (r.status === 'APPROVED') {
        if (!auth.permissions.has('leave.approve')) throw forbidden('Only an approver can cancel approved leave');
        if (r.payrollRunId) throw businessRule('This leave has been processed in payroll and cannot be cancelled. Use a payroll adjustment.');
        const employee = await tx.employee.findUniqueOrThrow({ where: { id: r.employeeId } });
        await assertPeriodOpen(tx, auth.tenantId, employee.payFrequency, r.startDate, r.endDate);
        await tx.leaveLedgerEntry.create({
          data: { tenantId: auth.tenantId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, entryType: 'REVERSAL', days: r.workingDays, effectiveDate: r.startDate, leaveRequestId: r.id, reason: 'Approved leave cancelled', createdById: auth.user.id },
        });
      } else {
        throw invalidState(`Request is already ${r.status.toLowerCase()}`);
      }
      await tx.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED', decisionComment: comment ?? r.decisionComment } });
      await tx.leaveApproval.create({ data: { tenantId: auth.tenantId, leaveRequestId: r.id, action: 'CANCELLED', actorUserId: auth.user.id, comment: comment ?? null } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'leave.cancelled', entityType: 'LeaveRequest', entityId: r.id, subjectEmployeeId: r.employeeId, before: { status: r.status }, after: { status: 'CANCELLED' }, reason: comment ?? null }, tx);
      return { id, status: 'CANCELLED' };
    });
  }

  async adjust(auth: TenantAuth, input: { employeeId: string; leaveTypeId: string; entryType: any; days: string; effectiveDate: string; reason: string }) {
    const employee = await this.prisma.employee.findFirst({ where: { id: input.employeeId, tenantId: auth.tenantId, deletedAt: null } });
    if (!employee) throw notFound('Employee');
    const type = await this.prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, tenantId: auth.tenantId } });
    if (!type) throw notFound('Leave type');
    const row = await this.prisma.leaveLedgerEntry.create({
      data: { tenantId: auth.tenantId, employeeId: employee.id, leaveTypeId: type.id, entryType: input.entryType, days: new D(input.days), effectiveDate: toDate(input.effectiveDate), reason: input.reason, createdById: auth.user.id },
    });
    await this.audit.record({ tenantId: auth.tenantId, action: 'leave.balance_adjusted', entityType: 'LeaveLedgerEntry', entityId: row.id, subjectEmployeeId: employee.id, after: input, reason: input.reason });
    return row;
  }

  async ledger(auth: TenantAuth, employeeId: string, leaveTypeId?: string) {
    const rows = await this.prisma.leaveLedgerEntry.findMany({
      where: { tenantId: auth.tenantId, employeeId, leaveTypeId: leaveTypeId || undefined },
      include: { leaveType: { select: { name: true, code: true } } },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((r) => ({ ...r, effectiveDate: isoDay(r.effectiveDate) }));
  }

  /**
   * LEA-004 accrual engine (idempotent via posting keys):
   * - ANNUAL_GRANT: full entitlement on 1 Jan each year once service requirement is met (key GRANT:YYYY)
   * - MONTHLY_ACCRUAL: entitlement ÷ 12 for each completed month in the year (key ACCRUAL:YYYY-MM)
   * - carried-forward days expire after carryForwardExpiryMonths, net of days used since 1 Jan (key CFEXP:YYYY)
   */
  async runAccruals(tenantId: string, asOfIso: string, actorUserId: string | null) {
    const asOf = toDate(asOfIso);
    const year = asOf.getUTCFullYear();
    const employees = await this.prisma.employee.findMany({ where: { tenantId, status: 'ACTIVE', deletedAt: null } });
    const types = await this.prisma.leaveType.findMany({ where: { tenantId, active: true, category: { not: 'UNPAID' } } });
    let posted = 0;
    for (const e of employees) {
      for (const t of types) {
        const policy = await this.policyFor(this.prisma, tenantId, t.id, e.employmentTypeId, asOf);
        if (!policy || policy.accrualMethod === 'NONE') continue;
        const eligibleFrom = addMonths(e.hireDate, policy.minServiceMonths);
        const entries: { key: string; days: Prisma.Decimal; date: Date; reason: string }[] = [];
        if (policy.accrualMethod === 'ANNUAL_GRANT') {
          const grantDate = new Date(Date.UTC(year, 0, 1));
          const effective = eligibleFrom > grantDate ? eligibleFrom : grantDate;
          if (effective <= asOf && effective.getUTCFullYear() === year) entries.push({ key: `GRANT:${year}`, days: policy.annualEntitlementDays, date: effective, reason: `Annual entitlement ${year}` });
        } else {
          const monthly = policy.annualEntitlementDays.dividedBy(12).toDecimalPlaces(2);
          for (let m = 0; m < 12; m++) {
            const monthEnd = new Date(Date.UTC(year, m + 1, 0));
            if (monthEnd > asOf) break;
            if (monthEnd < eligibleFrom) continue;
            entries.push({ key: `ACCRUAL:${year}-${String(m + 1).padStart(2, '0')}`, days: monthly, date: monthEnd, reason: `Monthly accrual ${year}-${String(m + 1).padStart(2, '0')}` });
          }
        }
        if (policy.carryForwardExpiryMonths > 0) {
          const cfEntry = await this.prisma.leaveLedgerEntry.findFirst({ where: { tenantId, employeeId: e.id, leaveTypeId: t.id, postingKey: `CF:${year - 1}` } });
          const expiry = addMonths(new Date(Date.UTC(year, 0, 1)), policy.carryForwardExpiryMonths);
          if (cfEntry && cfEntry.days.greaterThan(0) && expiry <= asOf) {
            const used = await this.prisma.leaveLedgerEntry.aggregate({
              where: { tenantId, employeeId: e.id, leaveTypeId: t.id, entryType: { in: ['USAGE', 'REVERSAL'] }, effectiveDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: expiry } },
              _sum: { days: true },
            });
            const usedDays = new D(used._sum.days ?? 0).negated();
            const toExpire = Prisma.Decimal.max(new D(0), cfEntry.days.minus(usedDays));
            if (toExpire.greaterThan(0)) entries.push({ key: `CFEXP:${year}`, days: toExpire.negated(), date: expiry, reason: 'Carried-forward days expired' });
          }
        }
        for (const en of entries) {
          try {
            await this.prisma.leaveLedgerEntry.create({
              data: {
                tenantId,
                employeeId: e.id,
                leaveTypeId: t.id,
                entryType: en.key.startsWith('CFEXP') ? 'EXPIRY' : 'ACCRUAL',
                days: en.days,
                effectiveDate: en.date,
                postingKey: en.key,
                reason: en.reason,
                createdById: actorUserId,
              },
            });
            posted++;
          } catch (err) {
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
          }
        }
      }
    }
    await this.audit.record({ tenantId, action: 'leave.accruals_run', entityType: 'LeaveLedgerEntry', metadata: { asOf: asOfIso, posted }, actorUserId });
    return { posted };
  }

  /** Year-end: caps balances at carryForwardMaxDays, expiring the excess; records the carried amount (key CF:YYYY). */
  async yearEnd(tenantId: string, year: number, actorUserId: string) {
    const yearEnd = new Date(Date.UTC(year, 11, 31));
    const employees = await this.prisma.employee.findMany({ where: { tenantId, deletedAt: null } });
    const types = await this.prisma.leaveType.findMany({ where: { tenantId, category: { not: 'UNPAID' } } });
    let processed = 0;
    for (const e of employees) {
      for (const t of types) {
        const policy = await this.policyFor(this.prisma, tenantId, t.id, e.employmentTypeId, yearEnd);
        if (!policy) continue;
        const sum = await this.prisma.leaveLedgerEntry.aggregate({ where: { tenantId, employeeId: e.id, leaveTypeId: t.id, effectiveDate: { lte: yearEnd } }, _sum: { days: true } });
        const balance = new D(sum._sum.days ?? 0);
        if (balance.lessThanOrEqualTo(0)) continue;
        const keep = Prisma.Decimal.min(balance, policy.carryForwardMaxDays);
        const excess = balance.minus(keep);
        const rows = [] as Prisma.LeaveLedgerEntryCreateManyInput[];
        if (excess.greaterThan(0)) rows.push({ tenantId, employeeId: e.id, leaveTypeId: t.id, entryType: 'EXPIRY', days: excess.negated(), effectiveDate: yearEnd, postingKey: `YE:${year}`, reason: `Year-end ${year}: excess over carry-forward limit expired`, createdById: actorUserId });
        // Zero-sum marker pair recording the carried amount for later expiry tracking.
        if (keep.greaterThan(0) && policy.carryForwardExpiryMonths > 0) {
          rows.push({ tenantId, employeeId: e.id, leaveTypeId: t.id, entryType: 'CARRY_FORWARD', days: keep, effectiveDate: new Date(Date.UTC(year + 1, 0, 1)), postingKey: `CF:${year}`, reason: `Carried forward from ${year}`, createdById: actorUserId });
          rows.push({ tenantId, employeeId: e.id, leaveTypeId: t.id, entryType: 'CARRY_FORWARD', days: keep.negated(), effectiveDate: yearEnd, postingKey: `CFOUT:${year}`, reason: `Closing ${year} balance carried forward`, createdById: actorUserId });
        }
        if (rows.length) {
          const r = await this.prisma.leaveLedgerEntry.createMany({ data: rows, skipDuplicates: true });
          processed += r.count;
        }
      }
    }
    await this.audit.record({ tenantId, action: 'leave.year_end_processed', entityType: 'LeaveLedgerEntry', metadata: { year, entries: processed }, actorUserId });
    return { entries: processed };
  }
}
