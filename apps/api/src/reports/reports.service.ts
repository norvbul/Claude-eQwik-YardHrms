import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Features, TenantPermissions as P } from '@yardhrms/authorization';
import { AppError, badRequest, forbidden } from '../common/errors';
import { ErrorCodes } from '@yardhrms/types';
import type { TenantAuth } from '../auth/auth-context';
import { fullName, isoDay, toDate, todayIso } from '../common/util';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { LeaveService } from '../leave/leave.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ReportResult } from './export.util';

const D = Prisma.Decimal;
const sumD = (vals: (Prisma.Decimal | null | undefined)[]) => vals.reduce<Prisma.Decimal>((a, v) => a.plus(v ?? 0), new D(0));

export const REPORT_CATALOG = [
  { type: 'employee-roster', name: 'Employee roster', group: 'HR', permission: P.REPORTS_HR },
  { type: 'hires-terminations', name: 'Hires & terminations', group: 'HR', permission: P.REPORTS_HR, feature: Features.ADVANCED_REPORTS },
  { type: 'leave-requests', name: 'Leave requests', group: 'HR', permission: P.REPORTS_HR },
  { type: 'leave-balances', name: 'Leave balances', group: 'HR', permission: P.REPORTS_HR },
  { type: 'absenteeism', name: 'Absenteeism (leave days by employee)', group: 'HR', permission: P.REPORTS_HR, feature: Features.ADVANCED_REPORTS },
  { type: 'timesheet-summary', name: 'Timesheet summary', group: 'HR', permission: P.REPORTS_HR },
  { type: 'overtime-summary', name: 'Overtime summary', group: 'HR', permission: P.REPORTS_HR },
  { type: 'payroll-register', name: 'Payroll register', group: 'Payroll', permission: P.REPORTS_PAYROLL, feature: Features.PAYROLL },
  { type: 'statutory-summary', name: 'Statutory deductions summary', group: 'Payroll', permission: P.REPORTS_PAYROLL, feature: Features.PAYROLL },
  { type: 'employer-contributions', name: 'Employer contributions', group: 'Payroll', permission: P.REPORTS_PAYROLL, feature: Features.PAYROLL },
  { type: 'department-costs', name: 'Department payroll cost summary', group: 'Payroll', permission: P.REPORTS_PAYROLL, feature: Features.PAYROLL },
  { type: 'earnings-deductions', name: 'Earnings & deductions summary', group: 'Payroll', permission: P.REPORTS_PAYROLL, feature: Features.PAYROLL },
  { type: 'payslip-history', name: 'Payslip distribution history', group: 'Payroll', permission: P.REPORTS_PAYROLL, feature: Features.PAYROLL },
  { type: 'bank-file-history', name: 'Bank file history', group: 'Payroll', permission: P.REPORTS_PAYROLL, feature: Features.PAYROLL },
] as const;

export type ReportType = (typeof REPORT_CATALOG)[number]['type'];

@Injectable()
export class ReportsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly leave: LeaveService,
  ) {}

  catalog(auth: TenantAuth) {
    return REPORT_CATALOG.map((r) => ({
      ...r,
      allowed: auth.permissions.has(r.permission) && (!('feature' in r) || !!auth.entitlements?.features.has(r.feature)),
    }));
  }

  /** RPT-005: every report validates RBAC, plan entitlement and tenant scope. */
  authorize(auth: TenantAuth, type: string) {
    const def = REPORT_CATALOG.find((r) => r.type === type);
    if (!def) throw badRequest('Unknown report');
    if (!auth.permissions.has(def.permission)) throw forbidden();
    if ('feature' in def && !auth.entitlements?.features.has(def.feature)) {
      throw new AppError(ErrorCodes.FEATURE_NOT_ENTITLED, `${def.name} is not included in your plan`, 402, { feature: def.feature });
    }
    return def;
  }

  private range(from?: string, to?: string) {
    const end = to ?? todayIso();
    const start = from ?? `${end.slice(0, 4)}-01-01`;
    if (start > end) throw badRequest('From date must be before To date');
    return { start, end, s: toDate(start), e: toDate(end) };
  }

  async run(auth: TenantAuth, type: string, q: { from?: string; to?: string; runId?: string; departmentId?: string }): Promise<ReportResult> {
    const def = this.authorize(auth, type);
    const t = auth.tenantId;
    const { start, end, s, e } = this.range(q.from, q.to);
    const parameters = { from: start, to: end, runId: q.runId, departmentId: q.departmentId };
    const approvedRuns: Prisma.PayrollRunWhereInput = { tenantId: t, status: { in: ['APPROVED', 'LOCKED'] }, period: { payDate: { gte: s, lte: e } } };

    switch (type as ReportType) {
      case 'employee-roster': {
        const rows = await this.prisma.employee.findMany({
          where: { tenantId: t, deletedAt: null, departmentId: q.departmentId || undefined },
          include: { department: true, position: true, employmentType: true, branch: true },
          orderBy: [{ lastName: 'asc' }],
        });
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'employeeNumber', label: 'Emp #' },
            { key: 'name', label: 'Name' },
            { key: 'department', label: 'Department' },
            { key: 'position', label: 'Position' },
            { key: 'branch', label: 'Branch' },
            { key: 'employmentType', label: 'Type' },
            { key: 'payFrequency', label: 'Frequency' },
            { key: 'hireDate', label: 'Hire date', type: 'date' },
            { key: 'status', label: 'Status' },
          ],
          rows: rows.map((r) => ({
            employeeNumber: r.employeeNumber,
            name: fullName(r),
            department: r.department?.name ?? '',
            position: r.position?.name ?? '',
            branch: r.branch?.name ?? '',
            employmentType: r.employmentType?.name ?? '',
            payFrequency: r.payFrequency,
            hireDate: isoDay(r.hireDate),
            status: r.status,
          })),
        };
      }
      case 'hires-terminations': {
        const rows = await this.prisma.employmentHistory.findMany({
          where: { tenantId: t, eventType: { in: ['HIRE', 'TERMINATION', 'DEACTIVATION', 'REACTIVATION'] }, eventDate: { gte: s, lte: e } },
          include: { employee: true },
          orderBy: { eventDate: 'asc' },
        });
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'event', label: 'Event' },
            { key: 'employeeNumber', label: 'Emp #' },
            { key: 'name', label: 'Name' },
            { key: 'reason', label: 'Reason' },
          ],
          rows: rows.map((r) => ({ date: isoDay(r.eventDate), event: r.eventType, employeeNumber: r.employee.employeeNumber, name: fullName(r.employee), reason: r.reason ?? '' })),
        };
      }
      case 'leave-requests': {
        const rows = await this.prisma.leaveRequest.findMany({
          where: { tenantId: t, startDate: { lte: e }, endDate: { gte: s } },
          include: { employee: true, leaveType: true },
          orderBy: { startDate: 'asc' },
        });
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'employeeNumber', label: 'Emp #' },
            { key: 'name', label: 'Name' },
            { key: 'type', label: 'Leave type' },
            { key: 'start', label: 'Start', type: 'date' },
            { key: 'end', label: 'End', type: 'date' },
            { key: 'days', label: 'Days', type: 'number' },
            { key: 'status', label: 'Status' },
            { key: 'delegated', label: 'Delegated' },
          ],
          rows: rows.map((r) => ({
            employeeNumber: r.employee.employeeNumber,
            name: fullName(r.employee),
            type: r.leaveType.name,
            start: isoDay(r.startDate),
            end: isoDay(r.endDate),
            days: r.workingDays.toString(),
            status: r.status,
            delegated: r.delegated ? 'Yes' : 'No',
          })),
        };
      }
      case 'leave-balances': {
        const emps = await this.prisma.employee.findMany({ where: { tenantId: t, deletedAt: null, status: 'ACTIVE' }, orderBy: { lastName: 'asc' } });
        const rows: Record<string, unknown>[] = [];
        for (const emp of emps) {
          for (const b of await this.leave.balances(t, emp.id)) {
            if (!b.tracked) continue;
            rows.push({ employeeNumber: emp.employeeNumber, name: fullName(emp), type: b.leaveTypeName, opening: b.opening, accrued: b.accrued, used: b.used, adjusted: b.adjusted, expired: b.expired, balance: b.balance, pending: b.pending });
          }
        }
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'employeeNumber', label: 'Emp #' },
            { key: 'name', label: 'Name' },
            { key: 'type', label: 'Leave type' },
            { key: 'opening', label: 'Opening', type: 'number' },
            { key: 'accrued', label: 'Accrued', type: 'number' },
            { key: 'used', label: 'Used', type: 'number' },
            { key: 'adjusted', label: 'Adjusted', type: 'number' },
            { key: 'expired', label: 'Expired', type: 'number' },
            { key: 'balance', label: 'Balance', type: 'number' },
            { key: 'pending', label: 'Pending', type: 'number' },
          ],
          rows,
        };
      }
      case 'absenteeism': {
        const groups = await this.prisma.leaveRequest.groupBy({ by: ['employeeId', 'leaveTypeId'], where: { tenantId: t, status: 'APPROVED', startDate: { lte: e }, endDate: { gte: s } }, _sum: { workingDays: true }, _count: true });
        const emps = await this.prisma.employee.findMany({ where: { tenantId: t, id: { in: groups.map((g) => g.employeeId) } } });
        const types = await this.prisma.leaveType.findMany({ where: { tenantId: t } });
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'employeeNumber', label: 'Emp #' },
            { key: 'name', label: 'Name' },
            { key: 'type', label: 'Leave type' },
            { key: 'occurrences', label: 'Occurrences', type: 'number' },
            { key: 'days', label: 'Days', type: 'number' },
          ],
          rows: groups.map((g) => {
            const emp = emps.find((x) => x.id === g.employeeId)!;
            return { employeeNumber: emp.employeeNumber, name: fullName(emp), type: types.find((x) => x.id === g.leaveTypeId)?.name, occurrences: g._count, days: (g._sum.workingDays ?? 0).toString() };
          }),
        };
      }
      case 'timesheet-summary': {
        const groups = await this.prisma.timesheet.groupBy({ by: ['employeeId', 'status'], where: { tenantId: t, workDate: { gte: s, lte: e } }, _sum: { regularHours: true }, _count: true });
        const emps = await this.prisma.employee.findMany({ where: { tenantId: t, id: { in: [...new Set(groups.map((g) => g.employeeId))] } } });
        const rows = emps.map((emp) => {
          const g = (st: string) => groups.find((x) => x.employeeId === emp.id && x.status === st);
          return {
            employeeNumber: emp.employeeNumber,
            name: fullName(emp),
            entries: groups.filter((x) => x.employeeId === emp.id).reduce((a, x) => a + x._count, 0),
            approvedHours: (g('APPROVED')?._sum.regularHours ?? 0).toString(),
            pendingHours: (g('PENDING')?._sum.regularHours ?? 0).toString(),
            rejectedHours: (g('REJECTED')?._sum.regularHours ?? 0).toString(),
          };
        });
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'employeeNumber', label: 'Emp #' },
            { key: 'name', label: 'Name' },
            { key: 'entries', label: 'Entries', type: 'number' },
            { key: 'approvedHours', label: 'Approved hrs', type: 'number' },
            { key: 'pendingHours', label: 'Pending hrs', type: 'number' },
            { key: 'rejectedHours', label: 'Rejected hrs', type: 'number' },
          ],
          rows,
        };
      }
      case 'overtime-summary': {
        const rows = await this.prisma.overtimeRequest.findMany({ where: { tenantId: t, workDate: { gte: s, lte: e } }, include: { employee: true, rule: true }, orderBy: { workDate: 'asc' } });
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'employeeNumber', label: 'Emp #' },
            { key: 'name', label: 'Name' },
            { key: 'category', label: 'Category' },
            { key: 'hours', label: 'Hours', type: 'number' },
            { key: 'multiplier', label: 'Multiplier', type: 'number' },
            { key: 'status', label: 'Status' },
          ],
          rows: rows.map((r) => ({ date: isoDay(r.workDate), employeeNumber: r.employee.employeeNumber, name: fullName(r.employee), category: r.rule.name, hours: r.hours.toString(), multiplier: r.multiplier.toString(), status: r.status })),
          totals: { hours: sumD(rows.filter((r) => r.status === 'APPROVED').map((r) => r.hours)).toString() },
        };
      }
      case 'payroll-register': {
        const where: Prisma.PayrollRunEmployeeWhereInput = q.runId ? { tenantId: t, runId: q.runId } : { tenantId: t, run: approvedRuns };
        const rows = await this.prisma.payrollRunEmployee.findMany({ where, include: { deductions: true, run: { include: { period: true } } }, orderBy: [{ run: { createdAt: 'asc' } }, { employeeName: 'asc' }] });
        const codes = [...new Set(rows.flatMap((r) => r.deductions.filter((d) => d.statutory).map((d) => d.code)))].sort();
        const out = rows.map((r) => {
          const base: Record<string, unknown> = {
            run: r.run.runNumber,
            payDate: isoDay(r.run.period.payDate),
            employeeNumber: r.employeeNumber,
            name: r.employeeName,
            department: r.departmentName ?? '',
            gross: r.grossPay.toFixed(2),
          };
          for (const c of codes) base[c] = sumD(r.deductions.filter((d) => d.code === c && d.statutory).map((d) => d.employeeAmount)).toFixed(2);
          base.other = sumD(r.deductions.filter((d) => !d.statutory).map((d) => d.employeeAmount)).toFixed(2);
          base.net = r.netPay.toFixed(2);
          base.employer = r.employerContributions.toFixed(2);
          return base;
        });
        const totals: Record<string, unknown> = { gross: sumD(rows.map((r) => r.grossPay)).toFixed(2), net: sumD(rows.map((r) => r.netPay)).toFixed(2), employer: sumD(rows.map((r) => r.employerContributions)).toFixed(2) };
        for (const c of [...codes, 'other']) totals[c] = sumD(out.map((o) => new D(String(o[c])))).toFixed(2);
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'run', label: 'Run' },
            { key: 'payDate', label: 'Pay date', type: 'date' },
            { key: 'employeeNumber', label: 'Emp #' },
            { key: 'name', label: 'Name' },
            { key: 'department', label: 'Department' },
            { key: 'gross', label: 'Gross', type: 'money' },
            ...codes.map((c) => ({ key: c, label: c, type: 'money' as const })),
            { key: 'other', label: 'Other ded.', type: 'money' },
            { key: 'net', label: 'Net', type: 'money' },
            { key: 'employer', label: 'Employer', type: 'money' },
          ],
          rows: out,
          totals,
        };
      }
      case 'statutory-summary':
      case 'employer-contributions': {
        const groups = await this.prisma.payrollDeduction.groupBy({
          by: ['code', 'description'],
          where: { tenantId: t, statutory: true, runEmployee: { run: approvedRuns } },
          _sum: { employeeAmount: true, employerAmount: true, base: true },
        });
        const rows = groups.map((g) => ({
          code: g.code,
          name: g.description,
          base: (g._sum.base ?? new D(0)).toFixed(2),
          employee: (g._sum.employeeAmount ?? new D(0)).toFixed(2),
          employer: (g._sum.employerAmount ?? new D(0)).toFixed(2),
          total: new D(g._sum.employeeAmount ?? 0).plus(g._sum.employerAmount ?? 0).toFixed(2),
        }));
        const filtered = type === 'employer-contributions' ? rows.filter((r) => Number(r.employer) !== 0) : rows;
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Component' },
            { key: 'base', label: 'Assessable base', type: 'money' },
            { key: 'employee', label: 'Employee', type: 'money' },
            { key: 'employer', label: 'Employer', type: 'money' },
            { key: 'total', label: 'Total remittance', type: 'money' },
          ],
          rows: filtered,
          totals: {
            employee: sumD(filtered.map((r) => new D(r.employee))).toFixed(2),
            employer: sumD(filtered.map((r) => new D(r.employer))).toFixed(2),
            total: sumD(filtered.map((r) => new D(r.total))).toFixed(2),
          },
        };
      }
      case 'department-costs': {
        const rows = await this.prisma.payrollRunEmployee.groupBy({
          by: ['departmentName'],
          where: { tenantId: t, run: approvedRuns },
          _sum: { grossPay: true, netPay: true, employerContributions: true, totalDeductions: true },
          _count: true,
        });
        const out = rows.map((r) => ({
          department: r.departmentName ?? 'Unassigned',
          headcount: r._count,
          gross: (r._sum.grossPay ?? new D(0)).toFixed(2),
          deductions: (r._sum.totalDeductions ?? new D(0)).toFixed(2),
          net: (r._sum.netPay ?? new D(0)).toFixed(2),
          employer: (r._sum.employerContributions ?? new D(0)).toFixed(2),
          cost: new D(r._sum.grossPay ?? 0).plus(r._sum.employerContributions ?? 0).toFixed(2),
        }));
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'department', label: 'Department' },
            { key: 'headcount', label: 'Payslips', type: 'number' },
            { key: 'gross', label: 'Gross', type: 'money' },
            { key: 'deductions', label: 'Employee deductions', type: 'money' },
            { key: 'net', label: 'Net', type: 'money' },
            { key: 'employer', label: 'Employer contributions', type: 'money' },
            { key: 'cost', label: 'Total employment cost', type: 'money' },
          ],
          rows: out,
          totals: { gross: sumD(out.map((o) => new D(o.gross))).toFixed(2), net: sumD(out.map((o) => new D(o.net))).toFixed(2), cost: sumD(out.map((o) => new D(o.cost))).toFixed(2) },
        };
      }
      case 'earnings-deductions': {
        const [earn, ded] = await Promise.all([
          this.prisma.payrollEarning.groupBy({ by: ['category', 'code'], where: { tenantId: t, runEmployee: { run: approvedRuns } }, _sum: { amount: true }, _count: true }),
          this.prisma.payrollDeduction.groupBy({ by: ['category', 'code'], where: { tenantId: t, runEmployee: { run: approvedRuns } }, _sum: { employeeAmount: true }, _count: true }),
        ]);
        const rows = [
          ...earn.map((r) => ({ kind: 'Earning', category: r.category, code: r.code, lines: r._count, amount: (r._sum.amount ?? new D(0)).toFixed(2) })),
          ...ded.map((r) => ({ kind: 'Deduction', category: r.category, code: r.code, lines: r._count, amount: (r._sum.employeeAmount ?? new D(0)).toFixed(2) })),
        ];
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'kind', label: 'Type' },
            { key: 'category', label: 'Category' },
            { key: 'code', label: 'Code' },
            { key: 'lines', label: 'Lines', type: 'number' },
            { key: 'amount', label: 'Amount', type: 'money' },
          ],
          rows,
        };
      }
      case 'payslip-history': {
        const rows = await this.prisma.payslipAccessEvent.findMany({ where: { tenantId: t, createdAt: { gte: s, lte: new Date(e.getTime() + 86_400_000) } }, orderBy: { createdAt: 'desc' }, take: 5000 });
        const [users, emps] = await Promise.all([
          this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, fullName: true } }),
          this.prisma.employee.findMany({ where: { tenantId: t, id: { in: [...new Set(rows.map((r) => r.employeeId))] } } }),
        ]);
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'at', label: 'Timestamp (UTC)' },
            { key: 'action', label: 'Action' },
            { key: 'employee', label: 'Employee' },
            { key: 'user', label: 'By user' },
          ],
          rows: rows.map((r) => {
            const emp = emps.find((x) => x.id === r.employeeId);
            return { at: r.createdAt.toISOString().replace('T', ' ').slice(0, 19), action: r.action, employee: emp ? `${emp.employeeNumber} ${fullName(emp)}` : r.employeeId, user: users.find((u) => u.id === r.userId)?.fullName ?? r.userId };
          }),
        };
      }
      case 'bank-file-history': {
        const rows = await this.prisma.bankExportBatch.findMany({ where: { tenantId: t, createdAt: { gte: s, lte: new Date(e.getTime() + 86_400_000) } }, include: { run: true }, orderBy: { createdAt: 'desc' } });
        return {
          title: def.name,
          parameters,
          columns: [
            { key: 'at', label: 'Generated (UTC)' },
            { key: 'run', label: 'Run' },
            { key: 'format', label: 'Format' },
            { key: 'rows', label: 'Rows', type: 'number' },
            { key: 'total', label: 'Total', type: 'money' },
            { key: 'sha256', label: 'SHA-256' },
          ],
          rows: rows.map((r) => ({ at: r.createdAt.toISOString().replace('T', ' ').slice(0, 19), run: r.run.runNumber, format: r.format, rows: r.rowCount, total: r.totalAmount.toFixed(2), sha256: r.sha256.slice(0, 16) })),
        };
      }
    }
    throw badRequest('Unknown report');
  }

  // ── Dashboards (RPT-001) ──────────────────────────────────────────────────
  async hrDashboard(auth: TenantAuth) {
    const t = auth.tenantId;
    const today = toDate(todayIso());
    const orgScope = auth.permissions.has(P.EMPLOYEES_READ);
    const subscription = await this.entitlements.summary(t);
    const mine = auth.employeeId
      ? {
          leaveBalances: (await this.leave.balances(t, auth.employeeId)).filter((b) => b.tracked),
          pendingLeave: await this.prisma.leaveRequest.count({ where: { tenantId: t, employeeId: auth.employeeId, status: 'PENDING' } }),
          pendingTimesheets: await this.prisma.timesheet.count({ where: { tenantId: t, employeeId: auth.employeeId, status: 'PENDING' } }),
          pendingOvertime: await this.prisma.overtimeRequest.count({ where: { tenantId: t, employeeId: auth.employeeId, status: 'PENDING' } }),
          latestPayslip: await this.prisma.payslip.findFirst({
            where: { tenantId: t, employeeId: auth.employeeId, run: { status: { in: ['APPROVED', 'LOCKED'] } } },
            orderBy: { payDate: 'desc' },
            select: { id: true, payDate: true, runEmployee: { select: { netPay: true, grossPay: true } } },
          }),
        }
      : null;
    if (!orgScope) return { scope: 'self', subscription, mine };

    const sixMonthsAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const [total, active, inactive, onLeave, pendingLeave, pendingTs, pendingOt, byDept, byType, byFreq, tsStatus, otAgg, latestRun, leaveRecent] = await Promise.all([
      this.prisma.employee.count({ where: { tenantId: t, deletedAt: null } }),
      this.prisma.employee.count({ where: { tenantId: t, deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.employee.count({ where: { tenantId: t, deletedAt: null, status: { not: 'ACTIVE' } } }),
      this.prisma.leaveRequest.count({ where: { tenantId: t, status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today } } }),
      this.prisma.leaveRequest.count({ where: { tenantId: t, status: 'PENDING' } }),
      this.prisma.timesheet.count({ where: { tenantId: t, status: 'PENDING' } }),
      this.prisma.overtimeRequest.count({ where: { tenantId: t, status: 'PENDING' } }),
      this.prisma.employee.groupBy({ by: ['departmentId'], where: { tenantId: t, deletedAt: null, status: 'ACTIVE' }, _count: true }),
      this.prisma.employee.groupBy({ by: ['employmentTypeId'], where: { tenantId: t, deletedAt: null, status: 'ACTIVE' }, _count: true }),
      this.prisma.employee.groupBy({ by: ['payFrequency'], where: { tenantId: t, deletedAt: null, status: 'ACTIVE' }, _count: true }),
      this.prisma.timesheet.groupBy({ by: ['status'], where: { tenantId: t, workDate: { gte: monthStart } }, _count: true, _sum: { regularHours: true } }),
      this.prisma.overtimeRequest.aggregate({ where: { tenantId: t, status: 'APPROVED', workDate: { gte: new Date(today.getTime() - 30 * 86_400_000) } }, _sum: { hours: true }, _count: true }),
      this.prisma.payrollRun.findFirst({ where: { tenantId: t }, orderBy: { createdAt: 'desc' }, include: { period: true } }),
      this.prisma.leaveRequest.findMany({ where: { tenantId: t, status: 'APPROVED', startDate: { gte: sixMonthsAgo } }, select: { startDate: true, workingDays: true } }),
    ]);
    const [depts, types] = await Promise.all([this.prisma.department.findMany({ where: { tenantId: t } }), this.prisma.employmentType.findMany({ where: { tenantId: t } })]);
    const leaveTrend: { month: string; days: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
      const key = d.toISOString().slice(0, 7);
      leaveTrend.push({ month: key, days: leaveRecent.filter((l) => isoDay(l.startDate)!.startsWith(key)).reduce((a, l) => a + Number(l.workingDays), 0) });
    }
    return {
      scope: 'org',
      subscription,
      mine,
      totals: { total, active, inactive, onLeave, pendingApprovals: pendingLeave + pendingTs + pendingOt, pendingLeave, pendingTimesheets: pendingTs, pendingOvertime: pendingOt },
      workforceByDepartment: byDept.map((g) => ({ name: depts.find((d) => d.id === g.departmentId)?.name ?? 'Unassigned', value: g._count })),
      workforceByType: byType.map((g) => ({ name: types.find((d) => d.id === g.employmentTypeId)?.name ?? 'Unspecified', value: g._count })),
      workforceByFrequency: byFreq.map((g) => ({ name: g.payFrequency, value: g._count })),
      timesheetsThisMonth: tsStatus.map((g) => ({ status: g.status, count: g._count, hours: (g._sum.regularHours ?? 0).toString() })),
      overtimeLast30Days: { requests: otAgg._count, hours: (otAgg._sum.hours ?? 0).toString() },
      latestPayroll: latestRun ? { id: latestRun.id, runNumber: latestRun.runNumber, status: latestRun.status, payDate: isoDay(latestRun.period.payDate), net: latestRun.netTotal.toString() } : null,
      leaveTrend,
    };
  }

  async payrollDashboard(auth: TenantAuth) {
    const t = auth.tenantId;
    const year = new Date().getUTCFullYear();
    const ys = new Date(Date.UTC(year, 0, 1));
    const ye = new Date(Date.UTC(year, 11, 31));
    const approved: Prisma.PayrollRunWhereInput = { tenantId: t, status: { in: ['APPROVED', 'LOCKED'] }, period: { payDate: { gte: ys, lte: ye } } };
    const [agg, stat, runs, byDept, statusCounts] = await Promise.all([
      this.prisma.payrollRun.aggregate({ where: approved, _sum: { grossTotal: true, netTotal: true, deductionTotal: true, employerTotal: true }, _count: true }),
      this.prisma.payrollDeduction.groupBy({ by: ['code'], where: { tenantId: t, statutory: true, runEmployee: { run: approved } }, _sum: { employeeAmount: true, employerAmount: true } }),
      this.prisma.payrollRun.findMany({ where: { tenantId: t, status: { in: ['APPROVED', 'LOCKED'] } }, include: { period: true }, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.prisma.payrollRunEmployee.groupBy({ by: ['departmentName'], where: { tenantId: t, run: approved }, _sum: { grossPay: true, employerContributions: true } }),
      this.prisma.payrollRun.groupBy({ by: ['status'], where: { tenantId: t }, _count: true }),
    ]);
    return {
      year,
      complianceCertified: this.config.PAYROLL_COMPLIANCE_CERTIFIED,
      totals: {
        runs: agg._count,
        gross: (agg._sum.grossTotal ?? 0).toString(),
        net: (agg._sum.netTotal ?? 0).toString(),
        employeeDeductions: (agg._sum.deductionTotal ?? 0).toString(),
        employerContributions: (agg._sum.employerTotal ?? 0).toString(),
        statutoryEmployee: sumD(stat.map((s) => s._sum.employeeAmount)).toString(),
      },
      statutoryByComponent: stat.map((s) => ({ code: s.code, employee: (s._sum.employeeAmount ?? 0).toString(), employer: (s._sum.employerAmount ?? 0).toString() })),
      byPeriod: runs
        .reverse()
        .map((r) => ({ runNumber: r.runNumber, payDate: isoDay(r.period.payDate), runType: r.runType, gross: r.grossTotal.toString(), net: r.netTotal.toString(), employer: r.employerTotal.toString() })),
      byDepartment: byDept.map((d) => ({ department: d.departmentName ?? 'Unassigned', gross: (d._sum.grossPay ?? 0).toString(), employer: (d._sum.employerContributions ?? 0).toString() })),
      runStatus: statusCounts.map((s) => ({ status: s.status, count: s._count })),
    };
  }
}
