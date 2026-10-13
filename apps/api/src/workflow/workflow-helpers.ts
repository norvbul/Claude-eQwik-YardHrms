import { TenantPermissions as P } from '@yardhrms/authorization';
import type { TenantAuth } from '../auth/auth-context';
import { businessRule, forbidden, notFound } from '../common/errors';
import { PrismaService, Tx } from '../prisma/prisma.service';

export type WorkflowKind = 'leave' | 'timesheets' | 'overtime';

const PERMS: Record<WorkflowKind, { self: string; any: string; readAny: string; approve: string }> = {
  leave: { self: P.LEAVE_SUBMIT_SELF, any: P.LEAVE_SUBMIT_ANY, readAny: P.LEAVE_READ_ANY, approve: P.LEAVE_APPROVE },
  timesheets: { self: P.TIMESHEETS_SUBMIT_SELF, any: P.TIMESHEETS_SUBMIT_ANY, readAny: P.TIMESHEETS_READ_ANY, approve: P.TIMESHEETS_APPROVE },
  overtime: { self: P.OVERTIME_SUBMIT_SELF, any: P.OVERTIME_SUBMIT_ANY, readAny: P.OVERTIME_READ_ANY, approve: P.OVERTIME_APPROVE },
};

/**
 * Resolves the transaction SUBJECT for a submission (PRD §4 delegation rule, TIM-005, AC-07):
 * - no employeeId (or own id) → self-service; requires *.submit.self and a linked employee record
 * - another employee → delegated; requires *.submit.any. The signed-in user is always the ACTOR.
 * Delegation never grants approval rights.
 */
export async function resolveSubject(prisma: PrismaService | Tx, auth: TenantAuth, kind: WorkflowKind, requestedEmployeeId?: string | null) {
  const perms = PERMS[kind];
  const targetId = requestedEmployeeId || auth.employeeId;
  if (!targetId) throw businessRule('Your user account is not linked to an employee record. Choose an employee or ask an administrator to link your profile.');
  const delegated = targetId !== auth.employeeId;
  if (delegated && !auth.permissions.has(perms.any)) throw forbidden('You can only submit records for yourself');
  if (!delegated && !auth.permissions.has(perms.self) && !auth.permissions.has(perms.any)) throw forbidden();
  const employee = await prisma.employee.findFirst({ where: { id: targetId, tenantId: auth.tenantId, deletedAt: null } });
  if (!employee) throw notFound('Employee');
  if (employee.status !== 'ACTIVE') throw businessRule('Records can only be submitted for active employees');
  return { employee, delegated };
}

/** Restricts list queries: users without read-any only see their own records. */
export function scopeEmployeeFilter(auth: TenantAuth, kind: WorkflowKind, requestedEmployeeId?: string, mine?: boolean): string | undefined | null {
  const canReadAny = auth.permissions.has(PERMS[kind].readAny);
  if (mine || !canReadAny) return auth.employeeId ?? null; // null → no results
  return requestedEmployeeId;
}

/** Approval policy: approval permission + no self-approval + optional separation from the submitter. */
export async function assertCanDecide(prisma: PrismaService | Tx, auth: TenantAuth, kind: WorkflowKind, record: { employeeId: string; submittedByUserId: string }) {
  if (!auth.permissions.has(PERMS[kind].approve)) throw forbidden('You are not authorized to approve these records');
  if (auth.employeeId && auth.employeeId === record.employeeId) throw forbidden('You cannot approve your own request');
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { requireSeparateApprover: true } });
  if (tenant.requireSeparateApprover && record.submittedByUserId === auth.user.id) {
    throw forbidden('Separation of duties: the person who submitted this record cannot also approve it');
  }
}

/** TIM-004 / payroll lock: dates inside a CLOSED payroll period cannot receive new or changed records. */
export async function assertPeriodOpen(prisma: PrismaService | Tx, tenantId: string, frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY', from: Date, to: Date = from) {
  const closed = await prisma.payrollPeriod.findFirst({
    where: { tenantId, frequency, status: 'CLOSED', periodStart: { lte: to }, periodEnd: { gte: from } },
    select: { periodStart: true, periodEnd: true },
  });
  if (closed) {
    throw businessRule(
      `The payroll period ${closed.periodStart.toISOString().slice(0, 10)} – ${closed.periodEnd.toISOString().slice(0, 10)} is locked. Changes require a payroll adjustment.`,
    );
  }
}
