import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RETENTION_RULES, defaultRetentionPolicy, type RetentionPolicy } from '@yardhrms/types';
import { AuditService } from '../audit/audit.service';
import { JobsService } from '../jobs/jobs.service';
import { taxYearStart } from '../payroll/payroll.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const DAY = 86_400_000;
const yearsAgo = (now: Date, n: number) => new Date(Date.UTC(now.getUTCFullYear() - n, now.getUTCMonth(), now.getUTCDate()));
const daysAgo = (now: Date, n: number) => new Date(now.getTime() - n * DAY);

export type RetentionSummary = Record<string, number>;

/**
 * NFR-011 data lifecycle. Applies each tenant's retention policy daily, honours legal holds, anonymises
 * former employees, purges statutory records only after their legal retention period, and completes the
 * purge of closed tenants. Statutory-record deletes run with @yardhrms_retention_purge = 1, the only way
 * past the database immutability triggers; the flag is set and cleared inside one transaction.
 */
@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger('Retention');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register('retention.daily', () => this.runAll());
  }

  async policy(tenantId: string): Promise<RetentionPolicy> {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { retentionPolicy: true } });
    const merged = { ...defaultRetentionPolicy(), ...((t.retentionPolicy as Partial<RetentionPolicy> | null) ?? {}) };
    // Never below the legal minimum, even if stored data says otherwise.
    for (const r of RETENTION_RULES) merged[r.key] = Math.max(r.min, merged[r.key]);
    return merged;
  }

  /** Runs `fn` in a transaction where statutory-record deletes are permitted. */
  private async withPurgeFlag<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.tx(
      async (tx) => {
        await tx.$executeRawUnsafe('SET @yardhrms_retention_purge = 1');
        try {
          return await fn(tx);
        } finally {
          await tx.$executeRawUnsafe('SET @yardhrms_retention_purge = NULL');
        }
      },
      { timeout: 300_000 },
    );
  }

  async runAll(now = new Date()): Promise<{ tenants: number; summary: RetentionSummary }> {
    const total: RetentionSummary = {};
    const add = (s: RetentionSummary) => Object.entries(s).forEach(([k, v]) => (total[k] = (total[k] ?? 0) + v));
    add(await this.platformHousekeeping(now));
    add(await this.executeDueDeletions(now));
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const t of tenants) {
      try {
        add(await this.runForTenant(t.id, now));
      } catch (e) {
        this.logger.error(`Retention failed for tenant ${t.id}: ${(e as Error).message}`);
      }
    }
    return { tenants: tenants.length, summary: total };
  }

  /** Non-tenant data: expired sessions, sign-in history, used/expired email tokens, email log, exports. */
  async platformHousekeeping(now = new Date()): Promise<RetentionSummary> {
    const s: RetentionSummary = {};
    s.sessions = (await this.prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: daysAgo(now, 365) } }, { revokedAt: { lt: daysAgo(now, 365) } }] } })).count;
    s.loginEvents = (await this.prisma.loginEvent.deleteMany({ where: { createdAt: { lt: daysAgo(now, 365) } } })).count;
    s.emailTokens = (await this.prisma.emailToken.deleteMany({ where: { expiresAt: { lt: daysAgo(now, 30) } } })).count;
    s.emailLog = (await this.prisma.outboundEmail.deleteMany({ where: { createdAt: { lt: daysAgo(now, 365) } } })).count;
    const exports = await this.prisma.dataExport.findMany({ where: { status: 'READY', expiresAt: { lt: now } } });
    for (const e of exports) {
      if (e.storageKey) await this.storage.remove(e.storageKey).catch(() => undefined);
      await this.prisma.dataExport.update({ where: { id: e.id }, data: { status: 'EXPIRED', storageKey: null } });
    }
    s.dataExportsExpired = exports.length;
    return s;
  }

  async runForTenant(tenantId: string, now = new Date()): Promise<RetentionSummary> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (tenant.legalHold) return { legalHoldSkipped: 1 };
    if (tenant.status === 'CLOSED') {
      if (tenant.purgeAfter && tenant.purgeAfter <= now) return this.purgeClosedTenant(tenantId, now);
      return {};
    }
    const p = await this.policy(tenantId);
    const s: RetentionSummary = {};
    const run = await this.prisma.retentionRun.create({ data: { tenantId } });

    // Import files and row data
    const imports = await this.prisma.importBatch.findMany({ where: { tenantId, filePurgedAt: null, createdAt: { lt: daysAgo(now, p.importFiles) }, status: { notIn: ['QUEUED', 'PROCESSING'] } }, select: { id: true, storageKey: true } });
    for (const b of imports) {
      await this.storage.remove(b.storageKey).catch(() => undefined);
      await this.prisma.importRow.deleteMany({ where: { batchId: b.id } });
      await this.prisma.importBatch.update({ where: { id: b.id }, data: { filePurgedAt: now } });
    }
    s.importFiles = imports.length;

    // Bank files (metadata kept)
    const banks = await this.prisma.bankExportBatch.findMany({ where: { tenantId, filePurgedAt: null, createdAt: { lt: daysAgo(now, p.bankFiles) } }, select: { id: true, storageKey: true } });
    for (const b of banks) {
      await this.storage.remove(b.storageKey).catch(() => undefined);
      await this.prisma.bankExportBatch.update({ where: { id: b.id }, data: { filePurgedAt: now } });
    }
    s.bankFiles = banks.length;

    s.notifications = (await this.prisma.notification.deleteMany({ where: { tenantId, createdAt: { lt: daysAgo(now, p.notifications) } } })).count;

    // Former employees: documents, then personal data
    const docCutoff = yearsAgo(now, p.employeeDocuments);
    const docs = await this.prisma.employeeDocument.findMany({ where: { tenantId, employee: { status: 'TERMINATED', terminationDate: { lt: docCutoff } } }, select: { id: true, storageKey: true } });
    for (const d of docs) await this.storage.remove(d.storageKey).catch(() => undefined);
    s.employeeDocuments = (await this.prisma.employeeDocument.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } })).count;

    const leavers = await this.prisma.employee.findMany({ where: { tenantId, status: 'TERMINATED', anonymisedAt: null, terminationDate: { lt: yearsAgo(now, p.employeeRecords) } }, select: { id: true, employeeNumber: true } });
    for (const e of leavers) await this.anonymiseEmployee(tenantId, e.id, e.employeeNumber, now);
    s.employeesAnonymised = leavers.length;

    // Statutory payroll records past retention (whole tax years only)
    s.payrollRuns = await this.purgePayroll(tenantId, p.payrollRecords, tenant.taxYearStartMonth, now);

    // Audit events
    s.auditEvents = await this.withPurgeFlag(async (tx) => (await tx.auditEvent.deleteMany({ where: { tenantId, createdAt: { lt: yearsAgo(now, p.auditLog) } } })).count);

    await this.prisma.retentionRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), summary: s } });
    if (Object.values(s).some((v) => v > 0)) {
      await this.audit.record({ tenantId, scope: 'SYSTEM', action: 'retention.applied', entityType: 'Tenant', entityId: tenantId, metadata: { summary: s, policy: p } });
    }
    return s;
  }

  /** Removes personal data but keeps the row (and employee number) so payroll history stays consistent. */
  async anonymiseEmployee(tenantId: string, employeeId: string, employeeNumber: string, now = new Date()) {
    const docs = await this.prisma.employeeDocument.findMany({ where: { tenantId, employeeId }, select: { storageKey: true } });
    for (const d of docs) await this.storage.remove(d.storageKey).catch(() => undefined);
    await this.prisma.tx(async (tx) => {
      await tx.employeeDocument.deleteMany({ where: { tenantId, employeeId } });
      await tx.employeeBankAccount.deleteMany({ where: { tenantId, employeeId } });
      await tx.employeeEmergencyContact.deleteMany({ where: { tenantId, employeeId } });
      await tx.employee.update({
        where: { id: employeeId },
        data: {
          firstName: 'Former',
          middleName: null,
          lastName: `employee ${employeeNumber}`,
          preferredName: null,
          email: null,
          phone: null,
          mobile: null,
          dateOfBirth: null,
          gender: null,
          addressLine1: null,
          addressLine2: null,
          city: null,
          parish: null,
          trnEnc: null,
          trnLast4: null,
          nisEnc: null,
          nisLast4: null,
          nhtEnc: null,
          nhtLast4: null,
          terminationReason: null,
          anonymisedAt: now,
        },
      });
      await tx.leaveRequest.updateMany({ where: { tenantId, employeeId }, data: { reason: null } });
      await this.audit.record({ tenantId, scope: 'SYSTEM', action: 'retention.employee_anonymised', entityType: 'Employee', entityId: employeeId, subjectEmployeeId: employeeId }, tx);
    });
  }

  private async purgePayroll(tenantId: string, years: number, startMonth: number, now: Date): Promise<number> {
    // A run may go once the tax year containing its pay date ended more than `years` ago.
    const currentYearStart = taxYearStart(now, startMonth);
    const cutoff = new Date(Date.UTC(currentYearStart.getUTCFullYear() - years, currentYearStart.getUTCMonth(), 1));
    const runs = await this.prisma.payrollRun.findMany({ where: { tenantId, period: { payDate: { lt: cutoff } } }, select: { id: true, periodId: true } });
    if (!runs.length) return 0;
    const runIds = runs.map((r) => r.id);
    const slips = await this.prisma.payslip.findMany({ where: { runId: { in: runIds } }, select: { id: true, storageKey: true } });
    const banks = await this.prisma.bankExportBatch.findMany({ where: { runId: { in: runIds } }, select: { storageKey: true, filePurgedAt: true } });
    for (const k of [...slips.map((x) => x.storageKey), ...banks.filter((b) => !b.filePurgedAt).map((b) => b.storageKey)]) if (k) await this.storage.remove(k).catch(() => undefined);
    await this.withPurgeFlag(async (tx) => {
      const slipIds = slips.map((x) => x.id);
      await tx.payslipAccessEvent.deleteMany({ where: { payslipId: { in: slipIds } } });
      await tx.payslip.deleteMany({ where: { id: { in: slipIds } } });
      await tx.bankExportBatch.deleteMany({ where: { runId: { in: runIds } } });
      const lines = await tx.payrollRunEmployee.findMany({ where: { runId: { in: runIds } }, select: { id: true } });
      await tx.payrollEarning.deleteMany({ where: { runEmployeeId: { in: lines.map((l) => l.id) } } });
      await tx.payrollDeduction.deleteMany({ where: { runEmployeeId: { in: lines.map((l) => l.id) } } });
      await tx.payrollRunEmployee.deleteMany({ where: { runId: { in: runIds } } });
      await tx.payrollAdjustment.deleteMany({ where: { runId: { in: runIds } } });
      await tx.timesheet.updateMany({ where: { tenantId, payrollRunId: { in: runIds } }, data: { payrollRunId: null } });
      await tx.overtimeRequest.updateMany({ where: { tenantId, payrollRunId: { in: runIds } }, data: { payrollRunId: null } });
      await tx.payrollRun.deleteMany({ where: { id: { in: runIds } } });
      const periodIds = [...new Set(runs.map((r) => r.periodId))];
      await tx.payrollPeriod.deleteMany({ where: { id: { in: periodIds }, runs: { none: {} } } });
    });
    await this.audit.record({ tenantId, scope: 'SYSTEM', action: 'retention.payroll_purged', entityType: 'Tenant', entityId: tenantId, metadata: { runs: runIds.length, payDateBefore: cutoff.toISOString().slice(0, 10) } });
    return runIds.length;
  }

  // ── Account closure (deletion workflow) ─────────────────────────────────

  /** Latest date on which statutory records of the tenant may be purged. */
  async statutoryPurgeDate(tenantId: string, now = new Date()): Promise<Date> {
    const p = await this.policy(tenantId);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { taxYearStartMonth: true } });
    const last = await this.prisma.payrollPeriod.findFirst({ where: { tenantId, runs: { some: { status: { in: ['APPROVED', 'LOCKED'] } } } }, orderBy: { payDate: 'desc' }, select: { payDate: true } });
    const lastLeaver = await this.prisma.employee.findFirst({ where: { tenantId }, orderBy: { terminationDate: 'desc' }, select: { terminationDate: true } });
    let purge = now;
    if (last) {
      const ys = taxYearStart(last.payDate, t.taxYearStartMonth);
      const yearEnd = new Date(Date.UTC(ys.getUTCFullYear() + 1, ys.getUTCMonth(), 1));
      const d = new Date(Date.UTC(yearEnd.getUTCFullYear() + p.payrollRecords, yearEnd.getUTCMonth(), 1));
      if (d > purge) purge = d;
    }
    // Employees still employed at closure are treated as leaving on the closure date.
    const anyActive = await this.prisma.employee.count({ where: { tenantId, status: { not: 'TERMINATED' } } });
    const leaverRef = anyActive ? now : lastLeaver?.terminationDate ?? null;
    if (leaverRef && last) {
      const d = new Date(Date.UTC(leaverRef.getUTCFullYear() + p.employeeRecords, leaverRef.getUTCMonth(), leaverRef.getUTCDate()));
      if (d > purge) purge = d;
    }
    return purge;
  }

  /** Executes APPROVED deletion requests whose cooling-off period has ended. */
  async executeDueDeletions(now = new Date()): Promise<RetentionSummary> {
    const due = await this.prisma.deletionRequest.findMany({ where: { status: 'APPROVED', coolingOffUntil: { lte: now } } });
    let executed = 0;
    for (const r of due) {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: r.tenantId } });
      if (tenant.legalHold) continue;
      const summary = await this.closeTenant(r.tenantId, now);
      await this.prisma.deletionRequest.update({ where: { id: r.id }, data: { status: 'EXECUTED', executedAt: now, summary } });
      executed++;
    }
    return { deletionsExecuted: executed };
  }

  /**
   * Closes a tenant: access ends immediately, data not required by law is erased now, and statutory
   * records are kept (inaccessible to the customer) until `purgeAfter`, when the daily job purges them.
   */
  async closeTenant(tenantId: string, now = new Date()): Promise<RetentionSummary> {
    const s: RetentionSummary = {};
    const purgeAfter = await this.statutoryPurgeDate(tenantId, now);
    const docs = await this.prisma.employeeDocument.findMany({ where: { tenantId }, select: { storageKey: true } });
    const imports = await this.prisma.importBatch.findMany({ where: { tenantId, filePurgedAt: null }, select: { id: true, storageKey: true } });
    const banks = await this.prisma.bankExportBatch.findMany({ where: { tenantId, filePurgedAt: null }, select: { id: true, storageKey: true } });
    const exports = await this.prisma.dataExport.findMany({ where: { tenantId, storageKey: { not: null } }, select: { storageKey: true } });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { logoKey: true } });
    for (const k of [...docs.map((d) => d.storageKey), ...imports.map((i) => i.storageKey), ...banks.map((b) => b.storageKey), ...exports.map((e) => e.storageKey!), tenant.logoKey].filter(Boolean)) {
      await this.storage.remove(k!).catch(() => undefined);
    }
    await this.prisma.tx(
      async (tx) => {
        s.employeeDocuments = (await tx.employeeDocument.deleteMany({ where: { tenantId } })).count;
        s.bankAccounts = (await tx.employeeBankAccount.deleteMany({ where: { tenantId } })).count;
        s.emergencyContacts = (await tx.employeeEmergencyContact.deleteMany({ where: { tenantId } })).count;
        await tx.importRow.deleteMany({ where: { tenantId } });
        await tx.importBatch.updateMany({ where: { id: { in: imports.map((i) => i.id) } }, data: { filePurgedAt: now } });
        await tx.bankExportBatch.updateMany({ where: { id: { in: banks.map((b) => b.id) } }, data: { filePurgedAt: now } });
        await tx.dataExport.updateMany({ where: { tenantId }, data: { storageKey: null, status: 'EXPIRED' } });
        s.notifications = (await tx.notification.deleteMany({ where: { tenantId } })).count;
        const members = await tx.tenantMembership.findMany({ where: { tenantId }, select: { userId: true } });
        await tx.tenantMembership.updateMany({ where: { tenantId }, data: { status: 'DEACTIVATED' } });
        await tx.session.updateMany({ where: { tenantId, revokedAt: null }, data: { revokedAt: now } });
        s.membershipsEnded = members.length;
        await tx.tenant.update({ where: { id: tenantId }, data: { status: 'CLOSED', closedAt: now, purgeAfter, logoKey: null } });
        await this.audit.record({ tenantId, scope: 'SYSTEM', action: 'tenant.closed', entityType: 'Tenant', entityId: tenantId, metadata: { purgeAfter: purgeAfter.toISOString().slice(0, 10), summary: s } }, tx);
      },
      { timeout: 120_000 },
    );
    return { ...s, purgeAfterEpochDays: Math.round(purgeAfter.getTime() / DAY) };
  }

  /** Final purge of a closed tenant once statutory retention has ended. Commercial records stay with Qwik. */
  async purgeClosedTenant(tenantId: string, now = new Date()): Promise<RetentionSummary> {
    const removedObjects = await this.storage.removePrefix(`tenants/${tenantId}/`).catch(() => 0);
    const s: RetentionSummary = { storageObjects: removedObjects };
    await this.withPurgeFlag(async (tx) => {
      const t = { tenantId };
      const slipIds = (await tx.payslip.findMany({ where: t, select: { id: true } })).map((x) => x.id);
      await tx.payslipAccessEvent.deleteMany({ where: { payslipId: { in: slipIds } } });
      await tx.payslip.deleteMany({ where: t });
      await tx.bankExportBatch.deleteMany({ where: t });
      const lineIds = (await tx.payrollRunEmployee.findMany({ where: t, select: { id: true } })).map((l) => l.id);
      await tx.payrollEarning.deleteMany({ where: { runEmployeeId: { in: lineIds } } });
      await tx.payrollDeduction.deleteMany({ where: { runEmployeeId: { in: lineIds } } });
      await tx.payrollRunEmployee.deleteMany({ where: t });
      await tx.payrollAdjustment.deleteMany({ where: t });
      await tx.timesheetApproval.deleteMany({ where: t });
      await tx.timesheet.deleteMany({ where: t });
      await tx.overtimeApproval.deleteMany({ where: t });
      await tx.overtimeRequest.deleteMany({ where: t });
      await tx.payrollRun.deleteMany({ where: t });
      await tx.payrollPeriod.deleteMany({ where: t });
      await tx.leaveApproval.deleteMany({ where: t });
      await tx.leaveLedgerEntry.deleteMany({ where: t });
      await tx.leaveRequest.deleteMany({ where: t });
      await tx.leavePolicy.deleteMany({ where: t });
      await tx.employeeAllowance.deleteMany({ where: t });
      await tx.employeeDeduction.deleteMany({ where: t });
      await tx.employeeBankAccount.deleteMany({ where: t });
      await tx.employeeDocument.deleteMany({ where: t });
      await tx.employeeEmergencyContact.deleteMany({ where: t });
      await tx.employmentHistory.deleteMany({ where: t });
      await tx.compensationHistory.deleteMany({ where: t });
      await tx.importRow.deleteMany({ where: t });
      await tx.importBatch.deleteMany({ where: t });
      await tx.reportExport.deleteMany({ where: t });
      await tx.dataExport.deleteMany({ where: t });
      await tx.notification.deleteMany({ where: t });
      await tx.emailToken.deleteMany({ where: t });
      await tx.session.deleteMany({ where: t });
      await tx.legacyIdMap.deleteMany({ where: t });
      await tx.tenantMembership.deleteMany({ where: t });
      await tx.employee.updateMany({ where: t, data: { supervisorId: null } });
      await tx.employee.deleteMany({ where: t });
      await tx.leaveType.deleteMany({ where: t });
      await tx.overtimeRule.deleteMany({ where: t });
      await tx.allowanceType.deleteMany({ where: t });
      await tx.deductionType.deleteMany({ where: t });
      await tx.position.deleteMany({ where: t });
      await tx.department.deleteMany({ where: t });
      await tx.branch.deleteMany({ where: t });
      await tx.employmentType.deleteMany({ where: t });
      await tx.shiftType.deleteMany({ where: t });
      await tx.publicHoliday.deleteMany({ where: t });
      await tx.payFrequencyConfig.deleteMany({ where: t });
      await tx.statutoryRuleVersion.deleteMany({ where: t });
      await tx.role.deleteMany({ where: t });
      await tx.backgroundJob.deleteMany({ where: t });
      s.auditEvents = (await tx.auditEvent.deleteMany({ where: t })).count;
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          legalName: `Closed organisation ${tenantId.slice(0, 8)}`,
          displayName: 'Closed organisation',
          tradingName: null,
          trn: null,
          nisEmployerNumber: null,
          nhtEmployerNumber: null,
          addressLine1: null,
          addressLine2: null,
          city: null,
          parish: null,
          phone: null,
          email: null,
          website: null,
          purgeAfter: null,
          retentionPolicy: Prisma.JsonNull,
        },
      });
    });
    await this.audit.record({ scope: 'PLATFORM', action: 'tenant.purged', entityType: 'Tenant', entityId: tenantId, metadata: { purgedAt: now.toISOString(), storageObjects: removedObjects } });
    return { ...s, tenantsPurged: 1 };
  }

}
