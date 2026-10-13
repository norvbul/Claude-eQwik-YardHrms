import { Injectable } from '@nestjs/common';
import { Prisma, type Employee } from '@prisma/client';
import { addDays, intervalsOverlap, shiftHours, shiftInterval } from '@yardhrms/payroll-engine';
import type { OvertimeInput, TimesheetInput } from '@yardhrms/types';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import type { TenantAuth } from '../auth/auth-context';
import { badRequest, businessRule, conflict, forbidden, invalidState, notFound } from '../common/errors';
import { isoDay, paginate, todayIso, toDate } from '../common/util';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { assertCanDecide, assertPeriodOpen, resolveSubject, scopeEmployeeFilter } from '../workflow/workflow-helpers';

export const MAX_SHIFT_HOURS = 16;
const D = Prisma.Decimal;

type ListQuery = { page: number; pageSize: number; status?: any; employeeId?: string; from?: string; to?: string; mine?: boolean };

@Injectable()
export class TimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** TIM-002 / AC-06: monthly employees never submit regular timesheets. */
  assertTimesheetEligible(employee: Pick<Employee, 'payFrequency' | 'status' | 'firstName' | 'lastName'>) {
    if (employee.payFrequency === 'MONTHLY') {
      throw businessRule(`${employee.firstName} ${employee.lastName} is paid monthly. Monthly employees do not submit regular timesheets — payroll uses the configured monthly standard hours.`, {
        reason: 'MONTHLY_TIMESHEET_NOT_ALLOWED',
      });
    }
    if (employee.status !== 'ACTIVE') throw businessRule('Timesheets can only be recorded for active employees');
  }

  /**
   * Validates and creates a regular timesheet (TIM-001/004/005/006). Shared by the API and bulk import.
   * Validates non-negative hours, overnight spans, hour limits, duplicates, overlaps (incl. adjacent-day
   * overnight shifts) and payroll-period locks. New records always start PENDING.
   */
  async createTimesheetInTx(
    tx: Tx,
    auth: Pick<TenantAuth, 'tenantId' | 'user'>,
    employee: Employee,
    input: Omit<TimesheetInput, 'employeeId'>,
    meta: { delegated: boolean; source: 'MANUAL' | 'IMPORT'; importBatchId?: string },
  ) {
    this.assertTimesheetEligible(employee);
    if (input.workDate > todayIso()) throw businessRule('Timesheets cannot be recorded for future dates');
    if (toDate(input.workDate) < employee.hireDate) throw businessRule('Work date is before the employee’s hire date');
    if (employee.terminationDate && toDate(input.workDate) > employee.terminationDate) throw businessRule('Work date is after the employee’s termination date');
    const breakHours = Number(input.breakHours ?? 0);
    let calc: ReturnType<typeof shiftHours>;
    try {
      calc = shiftHours(input.startTime, input.endTime, breakHours);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    if (calc.hours <= 0) throw businessRule('Regular hours must be greater than zero');
    if (calc.hours > MAX_SHIFT_HOURS) throw businessRule(`A single shift cannot exceed ${MAX_SHIFT_HOURS} regular hours; record additional time as overtime`);
    if (input.shiftTypeId) {
      const st = await tx.shiftType.findFirst({ where: { id: input.shiftTypeId, tenantId: auth.tenantId } });
      if (!st) throw badRequest('Shift type not found');
    }
    await assertPeriodOpen(tx, auth.tenantId, employee.payFrequency, toDate(input.workDate));

    // Overlap detection across the work date and adjacent days (overnight shifts)
    const prev = addDays(input.workDate, -1);
    const next = addDays(input.workDate, 1);
    const others = await tx.timesheet.findMany({
      where: { tenantId: auth.tenantId, employeeId: employee.id, status: { in: ['PENDING', 'APPROVED'] }, workDate: { gte: toDate(prev), lte: toDate(next) } },
    });
    const mine = shiftInterval(input.startTime, input.endTime);
    for (const o of others) {
      const offset = (isoDay(o.workDate) === prev ? -1 : isoDay(o.workDate) === next ? 1 : 0) * 1440;
      const [s, e] = shiftInterval(o.startTime, o.endTime);
      if (intervalsOverlap(mine, [s + offset, e + offset])) {
        throw conflict(`Overlaps an existing ${o.status.toLowerCase()} timesheet on ${isoDay(o.workDate)} (${o.startTime}–${o.endTime})`, { conflictingId: o.id });
      }
    }
    const activeKey = `${employee.id}|${input.workDate}|${input.startTime}`;
    try {
      const ts = await tx.timesheet.create({
        data: {
          tenantId: auth.tenantId,
          employeeId: employee.id,
          workDate: toDate(input.workDate),
          shiftTypeId: input.shiftTypeId ?? null,
          startTime: input.startTime,
          endTime: input.endTime,
          overnight: calc.overnight,
          breakHours: new D(breakHours),
          regularHours: new D(calc.hours),
          status: 'PENDING',
          activeKey,
          submittedByUserId: auth.user.id,
          delegated: meta.delegated,
          comments: input.comments ?? null,
          source: meta.source,
          importBatchId: meta.importBatchId ?? null,
        },
      });
      await tx.timesheetApproval.create({ data: { tenantId: auth.tenantId, timesheetId: ts.id, action: meta.delegated ? 'SUBMITTED_DELEGATED' : 'SUBMITTED', actorUserId: auth.user.id } });
      await this.audit.record(
        {
          tenantId: auth.tenantId,
          action: meta.delegated ? 'timesheet.submitted_delegated' : 'timesheet.submitted',
          entityType: 'Timesheet',
          entityId: ts.id,
          subjectEmployeeId: employee.id,
          after: { workDate: input.workDate, startTime: input.startTime, endTime: input.endTime, regularHours: calc.hours, source: meta.source },
          actorUserId: auth.user.id,
        },
        tx,
      );
      return ts;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('A timesheet for this employee, date and start time already exists');
      throw e;
    }
  }

  async createTimesheet(auth: TenantAuth, input: TimesheetInput) {
    return this.prisma.tx(async (tx) => {
      const { employee, delegated } = await resolveSubject(tx, auth, 'timesheets', input.employeeId);
      const ts = await this.createTimesheetInTx(tx, auth, employee, input, { delegated, source: 'MANUAL' });
      await this.notifications.requestSubmitted(tx, { tenantId: auth.tenantId, actorUserId: auth.user.id, actorName: auth.user.fullName }, {
        kind: 'timesheet',
        approvePermission: 'timesheets.approve',
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        summary: `${input.workDate} ${input.startTime}–${input.endTime} (${ts.regularHours.toString()} regular hours)`,
        link: '/app/timesheets',
        id: ts.id,
      });
      return { ...ts, workDate: isoDay(ts.workDate) };
    });
  }

  async listTimesheets(auth: TenantAuth, q: ListQuery) {
    const employeeId = scopeEmployeeFilter(auth, 'timesheets', q.employeeId, q.mine);
    if (employeeId === null) return paginate([], 0, q.page, q.pageSize);
    const where: Prisma.TimesheetWhereInput = { tenantId: auth.tenantId };
    if (employeeId) where.employeeId = employeeId;
    if (q.status) where.status = q.status;
    if (q.from || q.to) where.workDate = { gte: q.from ? toDate(q.from) : undefined, lte: q.to ? toDate(q.to) : undefined };
    const [total, rows] = await Promise.all([
      this.prisma.timesheet.count({ where }),
      this.prisma.timesheet.findMany({
        where,
        include: { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, payFrequency: true } } },
        orderBy: [{ workDate: 'desc' }, { startTime: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const names = await this.userNames(rows.flatMap((r) => [r.submittedByUserId, r.approvedByUserId]));
    return paginate(
      rows.map((r) => ({ ...r, workDate: isoDay(r.workDate), submittedBy: names(r.submittedByUserId), approvedBy: names(r.approvedByUserId) })),
      total,
      q.page,
      q.pageSize,
    );
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter(Boolean) as string[])];
    const users = unique.length ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } }) : [];
    return (id: string | null) => users.find((u) => u.id === id)?.fullName ?? null;
  }

  async decideTimesheet(auth: TenantAuth, id: string, decision: 'APPROVE' | 'REJECT', comment?: string | null) {
    return this.prisma.tx(async (tx) => {
      const ts = await tx.timesheet.findFirst({ where: { id, tenantId: auth.tenantId }, include: { employee: true } });
      if (!ts) throw notFound('Timesheet');
      if (ts.status !== 'PENDING') throw invalidState(`Timesheet is already ${ts.status.toLowerCase()}`);
      await assertCanDecide(tx, auth, 'timesheets', ts);
      await assertPeriodOpen(tx, auth.tenantId, ts.employee.payFrequency, ts.workDate);
      const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const res = await tx.timesheet.updateMany({
        where: { id, status: 'PENDING' },
        data: { status, approvedByUserId: auth.user.id, approvedAt: new Date(), decisionComment: comment ?? null, activeKey: status === 'REJECTED' ? null : ts.activeKey },
      });
      if (res.count !== 1) throw invalidState('Timesheet was already decided');
      await tx.timesheetApproval.create({ data: { tenantId: auth.tenantId, timesheetId: id, action: status, actorUserId: auth.user.id, comment: comment ?? null } });
      await this.audit.record({ tenantId: auth.tenantId, action: `timesheet.${status.toLowerCase()}`, entityType: 'Timesheet', entityId: id, subjectEmployeeId: ts.employeeId, before: { status: 'PENDING' }, after: { status }, reason: comment ?? null }, tx);
      await this.notifications.requestDecided(tx, { tenantId: auth.tenantId, actorUserId: auth.user.id, actorName: auth.user.fullName }, {
        kind: 'timesheet',
        employeeId: ts.employeeId,
        submittedByUserId: ts.submittedByUserId,
        status,
        summary: `Timesheet for ${ts.employee.firstName} ${ts.employee.lastName} on ${isoDay(ts.workDate)}`,
        comment,
        link: '/app/timesheets',
        id,
      });
      return { id, status };
    });
  }

  async cancelTimesheet(auth: TenantAuth, id: string) {
    return this.prisma.tx(async (tx) => {
      const ts = await tx.timesheet.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!ts) throw notFound('Timesheet');
      if (ts.status !== 'PENDING') throw invalidState('Only pending timesheets can be withdrawn');
      const own = ts.submittedByUserId === auth.user.id || ts.employeeId === auth.employeeId;
      if (!own && !auth.permissions.has('timesheets.approve')) throw forbidden();
      await tx.timesheet.update({ where: { id }, data: { status: 'CANCELLED', activeKey: null } });
      await tx.timesheetApproval.create({ data: { tenantId: auth.tenantId, timesheetId: id, action: 'CANCELLED', actorUserId: auth.user.id } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'timesheet.cancelled', entityType: 'Timesheet', entityId: id, subjectEmployeeId: ts.employeeId }, tx);
      return { id, status: 'CANCELLED' };
    });
  }

  // ── Overtime (TIM-003) ──────────────────────────────────────────────────
  async createOvertime(auth: TenantAuth, input: OvertimeInput) {
    return this.prisma.tx(async (tx) => {
      const { employee, delegated } = await resolveSubject(tx, auth, 'overtime', input.employeeId);
      if (!employee.overtimeEligible) throw businessRule(`${employee.firstName} ${employee.lastName} is not marked as overtime-eligible`, { reason: 'NOT_OVERTIME_ELIGIBLE' });
      if (input.workDate > todayIso()) throw businessRule('Overtime cannot be recorded for future dates');
      if (toDate(input.workDate) < employee.hireDate) throw businessRule('Work date is before the employee’s hire date');
      const rule = await tx.overtimeRule.findFirst({ where: { id: input.overtimeRuleId, tenantId: auth.tenantId, active: true } });
      if (!rule) throw badRequest('Overtime rule not found');
      await assertPeriodOpen(tx, auth.tenantId, employee.payFrequency, toDate(input.workDate));
      const dup = await tx.overtimeRequest.findFirst({ where: { tenantId: auth.tenantId, employeeId: employee.id, workDate: toDate(input.workDate), overtimeRuleId: rule.id, status: { in: ['PENDING', 'APPROVED'] } } });
      if (dup) throw conflict('An overtime request for this employee, date and category already exists');
      const ot = await tx.overtimeRequest.create({
        data: {
          tenantId: auth.tenantId,
          employeeId: employee.id,
          workDate: toDate(input.workDate),
          hours: new D(input.hours),
          overtimeRuleId: rule.id,
          multiplier: rule.multiplier,
          reason: input.reason,
          submittedByUserId: auth.user.id,
          delegated,
        },
      });
      await tx.overtimeApproval.create({ data: { tenantId: auth.tenantId, overtimeId: ot.id, action: delegated ? 'SUBMITTED_DELEGATED' : 'SUBMITTED', actorUserId: auth.user.id } });
      await this.audit.record(
        { tenantId: auth.tenantId, action: delegated ? 'overtime.submitted_delegated' : 'overtime.submitted', entityType: 'OvertimeRequest', entityId: ot.id, subjectEmployeeId: employee.id, after: { ...input, multiplier: rule.multiplier } },
        tx,
      );
      await this.notifications.requestSubmitted(tx, { tenantId: auth.tenantId, actorUserId: auth.user.id, actorName: auth.user.fullName }, {
        kind: 'overtime',
        approvePermission: 'overtime.approve',
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        summary: `${input.hours} hour(s) of ${rule.name} on ${input.workDate}`,
        link: '/app/overtime',
        id: ot.id,
      });
      return { ...ot, workDate: input.workDate };
    });
  }

  async listOvertime(auth: TenantAuth, q: ListQuery) {
    const employeeId = scopeEmployeeFilter(auth, 'overtime', q.employeeId, q.mine);
    if (employeeId === null) return paginate([], 0, q.page, q.pageSize);
    const where: Prisma.OvertimeRequestWhereInput = { tenantId: auth.tenantId };
    if (employeeId) where.employeeId = employeeId;
    if (q.status) where.status = q.status;
    if (q.from || q.to) where.workDate = { gte: q.from ? toDate(q.from) : undefined, lte: q.to ? toDate(q.to) : undefined };
    const [total, rows] = await Promise.all([
      this.prisma.overtimeRequest.count({ where }),
      this.prisma.overtimeRequest.findMany({
        where,
        include: { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, payFrequency: true } }, rule: { select: { name: true, code: true } } },
        orderBy: [{ workDate: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const names = await this.userNames(rows.flatMap((r) => [r.submittedByUserId, r.decidedByUserId]));
    return paginate(
      rows.map((r) => ({ ...r, workDate: isoDay(r.workDate), submittedBy: names(r.submittedByUserId), decidedBy: names(r.decidedByUserId) })),
      total,
      q.page,
      q.pageSize,
    );
  }

  async decideOvertime(auth: TenantAuth, id: string, decision: 'APPROVE' | 'REJECT', comment?: string | null) {
    return this.prisma.tx(async (tx) => {
      const ot = await tx.overtimeRequest.findFirst({ where: { id, tenantId: auth.tenantId }, include: { employee: true } });
      if (!ot) throw notFound('Overtime request');
      if (ot.status !== 'PENDING') throw invalidState(`Overtime is already ${ot.status.toLowerCase()}`);
      await assertCanDecide(tx, auth, 'overtime', ot);
      await assertPeriodOpen(tx, auth.tenantId, ot.employee.payFrequency, ot.workDate);
      if (decision === 'APPROVE' && !ot.employee.overtimeEligible) throw businessRule('Employee is no longer overtime-eligible');
      const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const res = await tx.overtimeRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status, decidedByUserId: auth.user.id, decidedAt: new Date(), decisionComment: comment ?? null } });
      if (res.count !== 1) throw invalidState('Overtime was already decided');
      await tx.overtimeApproval.create({ data: { tenantId: auth.tenantId, overtimeId: id, action: status, actorUserId: auth.user.id, comment: comment ?? null } });
      await this.audit.record({ tenantId: auth.tenantId, action: `overtime.${status.toLowerCase()}`, entityType: 'OvertimeRequest', entityId: id, subjectEmployeeId: ot.employeeId, before: { status: 'PENDING' }, after: { status }, reason: comment ?? null }, tx);
      await this.notifications.requestDecided(tx, { tenantId: auth.tenantId, actorUserId: auth.user.id, actorName: auth.user.fullName }, {
        kind: 'overtime',
        employeeId: ot.employeeId,
        submittedByUserId: ot.submittedByUserId,
        status,
        summary: `Overtime for ${ot.employee.firstName} ${ot.employee.lastName} on ${isoDay(ot.workDate)} (${ot.hours.toString()} h)`,
        comment,
        link: '/app/overtime',
        id,
      });
      return { id, status };
    });
  }

  async cancelOvertime(auth: TenantAuth, id: string) {
    return this.prisma.tx(async (tx) => {
      const ot = await tx.overtimeRequest.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!ot) throw notFound('Overtime request');
      if (ot.status !== 'PENDING') throw invalidState('Only pending overtime can be withdrawn');
      const own = ot.submittedByUserId === auth.user.id || ot.employeeId === auth.employeeId;
      if (!own && !auth.permissions.has('overtime.approve')) throw forbidden();
      await tx.overtimeRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.overtimeApproval.create({ data: { tenantId: auth.tenantId, overtimeId: id, action: 'CANCELLED', actorUserId: auth.user.id } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'overtime.cancelled', entityType: 'OvertimeRequest', entityId: id, subjectEmployeeId: ot.employeeId }, tx);
      return { id, status: 'CANCELLED' };
    });
  }
}
