import { createHash } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import JSZip from 'jszip';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto.service';
import { isoDay } from '../common/util';
import { JobsService } from '../jobs/jobs.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { toCsv } from '../reports/export.util';
import { StorageService } from '../storage/storage.service';

const EXPORT_DAYS = 7;

function csv(title: string, rows: Record<string, unknown>[]): Buffer {
  const keys = rows.length ? Object.keys(rows[0]) : ['(no records)'];
  const norm = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v !== null && typeof v === 'object' ? JSON.stringify(v) : v])));
  return toCsv({ title, columns: keys.map((k) => ({ key: k, label: k })), rows: norm });
}

/**
 * NFR-011 customer data export: one ZIP with every record the company holds in YardHRMS (CSV), its
 * payslip PDFs and a manifest. Sensitive identifiers are included in clear because this is the
 * controller's own data; the bundle is private, audited and expires after seven days.
 */
@Injectable()
export class DataExportService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit() {
    this.jobs.register('data.export', (p: { exportId: string }) => this.build(p.exportId));
  }

  async request(tenantId: string, userId: string) {
    const running = await this.prisma.dataExport.findFirst({ where: { tenantId, status: 'QUEUED' } });
    if (running) return running;
    const e = await this.prisma.dataExport.create({ data: { tenantId, requestedById: userId } });
    await this.jobs.enqueue('data.export', { exportId: e.id }, { tenantId, dedupeKey: `export:${e.id}` });
    await this.audit.record({ tenantId, action: 'data.export_requested', entityType: 'DataExport', entityId: e.id, actorUserId: userId });
    return e;
  }

  async build(exportId: string) {
    const ex = await this.prisma.dataExport.findUniqueOrThrow({ where: { id: exportId } });
    if (ex.status !== 'QUEUED') return { skipped: true };
    const t = { tenantId: ex.tenantId };
    try {
      const zip = new JSZip();
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ex.tenantId } });
      const counts: Record<string, number> = {};
      const add = (name: string, rows: Record<string, unknown>[]) => {
        counts[name] = rows.length;
        zip.file(`data/${name}.csv`, csv(name, rows));
      };
      const { logoKey: _l, retentionPolicy, ...profile } = tenant;
      zip.file('data/company.json', JSON.stringify({ ...profile, retentionPolicy }, null, 2));
      const employees = await this.prisma.employee.findMany({ where: t, orderBy: { employeeNumber: 'asc' } });
      add(
        'employees',
        employees.map(({ trnEnc, nisEnc, nhtEnc, ...e }) => ({ ...e, trn: this.crypto.decryptNullable(trnEnc), nisNumber: this.crypto.decryptNullable(nisEnc), nhtNumber: this.crypto.decryptNullable(nhtEnc) })),
      );
      add('employee_bank_accounts', (await this.prisma.employeeBankAccount.findMany({ where: t })).map(({ accountNumberEnc, ...b }: any) => ({ ...b, accountNumber: this.crypto.decryptNullable(accountNumberEnc) })));
      add('employee_emergency_contacts', await this.prisma.employeeEmergencyContact.findMany({ where: t }));
      add('employment_history', await this.prisma.employmentHistory.findMany({ where: t }));
      add('compensation_history', await this.prisma.compensationHistory.findMany({ where: t }));
      add('employee_allowances', await this.prisma.employeeAllowance.findMany({ where: t }));
      add('employee_deductions', await this.prisma.employeeDeduction.findMany({ where: t }));
      add('departments', await this.prisma.department.findMany({ where: t }));
      add('branches', await this.prisma.branch.findMany({ where: t }));
      add('positions', await this.prisma.position.findMany({ where: t }));
      add('leave_types', await this.prisma.leaveType.findMany({ where: t }));
      add('leave_requests', await this.prisma.leaveRequest.findMany({ where: t }));
      add('leave_ledger', await this.prisma.leaveLedgerEntry.findMany({ where: t }));
      add('timesheets', await this.prisma.timesheet.findMany({ where: t }));
      add('overtime_requests', await this.prisma.overtimeRequest.findMany({ where: t }));
      add('statutory_rule_versions', await this.prisma.statutoryRuleVersion.findMany({ where: t, include: { components: { include: { brackets: true } } } }));
      add('payroll_periods', await this.prisma.payrollPeriod.findMany({ where: t }));
      add('payroll_runs', await this.prisma.payrollRun.findMany({ where: t }));
      add('payroll_lines', (await this.prisma.payrollRunEmployee.findMany({ where: t })).map(({ calculation: _c, inputs: _i, ...r }) => r));
      add('payroll_earnings', await this.prisma.payrollEarning.findMany({ where: t }));
      add('payroll_deductions', await this.prisma.payrollDeduction.findMany({ where: t }));
      const members = await this.prisma.tenantMembership.findMany({ where: t, include: { user: { select: { email: true, fullName: true } }, roles: { include: { role: { select: { code: true } } } } } });
      add('users', members.map((m) => ({ email: m.user.email, name: m.user.fullName, status: m.status, roles: m.roles.map((r) => r.role.code).join(' '), employeeId: m.employeeId, createdAt: m.createdAt })));
      add('audit_log', await this.prisma.auditEvent.findMany({ where: t, orderBy: { createdAt: 'asc' } }));
      const slips = await this.prisma.payslip.findMany({ where: { ...t, storageKey: { not: null } }, include: { runEmployee: { select: { employeeNumber: true } } } });
      let pdfs = 0;
      for (const s of slips) {
        const buf = await this.storage.get(s.storageKey!).catch(() => null);
        if (!buf) continue;
        zip.file(`payslips/${isoDay(s.payDate)}_${s.runEmployee.employeeNumber}_${s.id.slice(0, 8)}.pdf`, buf);
        pdfs++;
      }
      counts.payslipPdfs = pdfs;
      zip.file(
        'README.txt',
        [
          `eQwik YardHRMS data export for ${tenant.legalName}`,
          `Generated: ${new Date().toISOString()}`,
          '',
          'data/*.csv  — one file per record type (UTF-8, comma separated). Amounts are JMD unless a currency column says otherwise.',
          'payslips/   — approved payslip PDFs.',
          '',
          'This archive contains personal and payroll data, including TRN/NIS/NHT numbers and bank account numbers.',
          'Store it securely and delete it when it is no longer needed (Data Protection Act, 2020).',
        ].join('\n'),
      );
      zip.file('manifest.json', JSON.stringify({ tenantId: ex.tenantId, exportId: ex.id, generatedAt: new Date().toISOString(), counts }, null, 2));
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const key = this.storage.key(`tenants/${ex.tenantId}`, 'exports', `${ex.id}.zip`);
      await this.storage.put(key, buf, 'application/zip');
      await this.prisma.dataExport.update({
        where: { id: ex.id },
        data: { status: 'READY', storageKey: key, sizeBytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), completedAt: new Date(), expiresAt: new Date(Date.now() + EXPORT_DAYS * 86_400_000) },
      });
      await this.notifications.notify(this.prisma, {
        tenantId: ex.tenantId,
        userIds: [ex.requestedById],
        category: 'decisions',
        type: 'data_export_ready',
        title: 'Your data export is ready',
        body: `The full export of your organization’s data is ready to download for ${EXPORT_DAYS} days.`,
        link: '/app/settings/data',
        dedupeKey: `export:${ex.id}`,
      });
      return { counts, bytes: buf.length };
    } catch (e) {
      await this.prisma.dataExport.update({ where: { id: ex.id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 500) } });
      throw e;
    }
  }
}
