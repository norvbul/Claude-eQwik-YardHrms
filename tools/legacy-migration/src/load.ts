import { createHash } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { employeeCreateSchema } from '@yardhrms/types';
import { AuditService } from '@yardhrms/api/dist/audit/audit.service';
import { EmployeesService } from '@yardhrms/api/dist/employees/employees.service';
import { EntitlementsService } from '@yardhrms/api/dist/entitlements/entitlements.service';
import { JobsService } from '@yardhrms/api/dist/jobs/jobs.service';
import type { PrismaService } from '@yardhrms/api/dist/prisma/prisma.service';
import type { MigrationActor } from './context';
import type { CanonicalDataset, CanonicalEmployee, CanonicalPayPeriod } from './transform';

type Tx = Prisma.TransactionClient;
export type Outcome = 'CREATED' | 'MATCHED' | 'SKIPPED_EXISTING' | 'REJECTED';
export interface LoadRow { entity: string; legacyId: string; outcome: Outcome; newId?: string; message?: string }
export interface LoadReport { tenantId: string; actor: string; dryRun: boolean; startedAt: string; finishedAt?: string; rows: LoadRow[]; summary: Record<string, Partial<Record<Outcome, number>>> }

const STATUTORY_NAMES: Record<string, string> = { NIS: 'National Insurance Scheme', NHT: 'National Housing Trust', EDTAX: 'Education Tax', PAYE: 'Income Tax (PAYE)', HEART: 'HEART/NSTA Trust (employer)' };

/**
 * Loads a canonical dataset into one tenant. Ordering follows PRD §14: master data → employees →
 * leave opening balances → payroll history. Every record is written in its own transaction together
 * with its legacy_id_map row, so a re-run (or a final delta import at cutover) skips what already exists.
 */
export async function load(app: INestApplicationContext, prisma: PrismaService, actor: MigrationActor, data: CanonicalDataset, opts: { dryRun: boolean; log: (m: string) => void }): Promise<LoadReport> {
  const employees = app.get(EmployeesService);
  const entitlements = app.get(EntitlementsService);
  const audit = app.get(AuditService);
  const jobs = app.get(JobsService);
  const { tenantId } = actor;
  const report: LoadReport = { tenantId, actor: actor.user.email, dryRun: opts.dryRun, startedAt: new Date().toISOString(), rows: [], summary: {} };
  const note = (r: LoadRow) => {
    report.rows.push(r);
    const s = (report.summary[r.entity] ??= {});
    s[r.outcome] = (s[r.outcome] ?? 0) + 1;
  };
  const mapped = async (client: Tx | PrismaService, entityType: string, legacyId: string) =>
    (await client.legacyIdMap.findUnique({ where: { tenantId_entityType_legacyId: { tenantId, entityType, legacyId } } }))?.newId ?? null;
  const remember = (tx: Tx, entityType: string, legacyId: string, newId: string) => tx.legacyIdMap.create({ data: { tenantId, entityType, legacyId, newId } });
  const auditMigration = (tx: Tx, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) =>
    audit.record({ tenantId, action, entityType, entityId, actorUserId: actor.user.id, metadata: { ...metadata, source: 'legacy-migration' } } as any, tx);

  // ── Preflight: subscription capacity for ACTIVE employees (historical ones do not consume seats) ──
  const pending: CanonicalEmployee[] = [];
  for (const e of data.employees) if (!(await mapped(prisma, 'Employee', e.legacyId))) pending.push(e);
  const ent = await entitlements.forTenant(tenantId);
  if (ent.readOnly) throw new Error(`The ${ent.planName} subscription is ${ent.status}; restore it before migrating`);
  const active = await entitlements.countActiveEmployees(prisma, tenantId);
  const incoming = pending.filter((e) => e.status === 'ACTIVE').length;
  opts.log(`Capacity: ${active} active now + ${incoming} incoming ≤ ${ent.employeeLimit} (${ent.planName})`);
  if (active + incoming > ent.employeeLimit) {
    throw new Error(`The ${ent.planName} plan allows ${ent.employeeLimit} active employees; migrating would need ${active + incoming}. Activate a suitable subscription in the Licence Manager first.`);
  }
  if (opts.dryRun) {
    opts.log('Dry run: no records written.');
    for (const e of pending) note({ entity: 'Employee', legacyId: e.legacyId, outcome: 'CREATED', message: 'would be created' });
    report.finishedAt = new Date().toISOString();
    return report;
  }

  // ── Reference data ───────────────────────────────────────────────────────
  const refIds = { Department: new Map<string, string>(), Branch: new Map<string, string>(), Position: new Map<string, string>() };
  const loadRef = async (entity: keyof typeof refIds, rows: { legacyId: string; code: string; name: string }[], create: (tx: Tx, r: any) => Promise<{ id: string }>, find: (tx: Tx, code: string) => Promise<{ id: string } | null>) => {
    for (const r of rows) {
      const existing = await mapped(prisma, entity, r.legacyId);
      if (existing) {
        refIds[entity].set(r.legacyId, existing);
        note({ entity, legacyId: r.legacyId, outcome: 'SKIPPED_EXISTING', newId: existing });
        continue;
      }
      const res = await prisma.$transaction(async (tx) => {
        const match = await find(tx, r.code);
        const row = match ?? (await create(tx, r));
        await remember(tx, entity, r.legacyId, row.id);
        if (!match) await auditMigration(tx, `migration.${entity.toLowerCase()}_created`, entity, row.id, { legacyId: r.legacyId });
        return { id: row.id, matched: !!match };
      });
      refIds[entity].set(r.legacyId, res.id);
      note({ entity, legacyId: r.legacyId, outcome: res.matched ? 'MATCHED' : 'CREATED', newId: res.id });
    }
  };
  await loadRef('Department', data.departments, (tx, r) => tx.department.create({ data: { tenantId, code: r.code, name: r.name, costCenter: r.costCenter } }), (tx, code) => tx.department.findUnique({ where: { tenantId_code: { tenantId, code } } }));
  await loadRef('Branch', data.branches, (tx, r) => tx.branch.create({ data: { tenantId, code: r.code, name: r.name, parish: r.parish, address: r.address } }), (tx, code) => tx.branch.findUnique({ where: { tenantId_code: { tenantId, code } } }));
  await loadRef(
    'Position',
    data.positions,
    (tx, r) => tx.position.create({ data: { tenantId, code: r.code, name: r.name, departmentId: r.departmentLegacyId ? (refIds.Department.get(r.departmentLegacyId) ?? null) : null } }),
    (tx, code) => tx.position.findUnique({ where: { tenantId_code: { tenantId, code } } }),
  );
  opts.log(`Reference data: ${data.departments.length} departments, ${data.branches.length} branches, ${data.positions.length} positions`);

  // ── Employees (through the same service the API uses: validation, encryption, history, audit) ──
  const empIds = new Map<string, string>();
  for (const e of data.employees) {
    const existing = await mapped(prisma, 'Employee', e.legacyId);
    if (existing) {
      empIds.set(e.legacyId, existing);
      note({ entity: 'Employee', legacyId: e.legacyId, outcome: 'SKIPPED_EXISTING', newId: existing });
      continue;
    }
    try {
      const id = await prisma.tx(async (tx) => {
        let number = e.employeeNumber;
        if (number && (await tx.employee.findUnique({ where: { tenantId_employeeNumber: { tenantId, employeeNumber: number } } }))) number = null;
        number ??= await employees.nextEmployeeNumber(tx, tenantId);
        const input = employeeCreateSchema.parse({
          ...e,
          employeeNumber: number,
          departmentId: e.departmentLegacyId ? refIds.Department.get(e.departmentLegacyId) : null,
          branchId: e.branchLegacyId ? refIds.Branch.get(e.branchLegacyId) : null,
          positionId: e.positionLegacyId ? refIds.Position.get(e.positionLegacyId) : null,
        });
        const created = await employees.createInTx(tx, { tenantId, user: actor.user } as any, input, 'MIGRATION', {
          status: e.status,
          terminationDate: e.terminationDate,
          terminationReason: e.terminationReason,
        });
        await remember(tx, 'Employee', e.legacyId, created.id);
        return created.id;
      });
      empIds.set(e.legacyId, id);
      note({ entity: 'Employee', legacyId: e.legacyId, outcome: 'CREATED', newId: id });
    } catch (err) {
      note({ entity: 'Employee', legacyId: e.legacyId, outcome: 'REJECTED', message: (err as Error).message.slice(0, 500) });
    }
  }
  opts.log(`Employees: ${report.summary.Employee?.CREATED ?? 0} created, ${report.summary.Employee?.SKIPPED_EXISTING ?? 0} already migrated, ${report.summary.Employee?.REJECTED ?? 0} rejected`);

  // ── Leave opening balances (append-only ledger, idempotent posting key) ──
  const leaveTypes = new Map((await prisma.leaveType.findMany({ where: { tenantId } })).map((t) => [t.code.toUpperCase(), t.id]));
  for (const b of data.leaveBalances) {
    const legacyId = `${b.employeeLegacyId}:${b.leaveTypeCode}`;
    const employeeId = empIds.get(b.employeeLegacyId);
    const leaveTypeId = leaveTypes.get(b.leaveTypeCode);
    if (!employeeId || !leaveTypeId) {
      note({ entity: 'LeaveOpeningBalance', legacyId, outcome: 'REJECTED', message: !employeeId ? 'Employee was not migrated' : `Leave type ${b.leaveTypeCode} does not exist in the tenant (create it or map the code)` });
      continue;
    }
    const exists = await prisma.leaveLedgerEntry.findUnique({ where: { tenantId_employeeId_leaveTypeId_postingKey: { tenantId, employeeId, leaveTypeId, postingKey: 'legacy-opening' } } });
    if (exists) {
      note({ entity: 'LeaveOpeningBalance', legacyId, outcome: 'SKIPPED_EXISTING', newId: exists.id });
      continue;
    }
    const row = await prisma.leaveLedgerEntry.create({
      data: { tenantId, employeeId, leaveTypeId, entryType: 'OPENING', days: new Prisma.Decimal(b.days), effectiveDate: new Date(`${b.asOfDate}T00:00:00Z`), reason: 'Opening balance migrated from legacy YardHRMS', postingKey: 'legacy-opening', createdById: actor.user.id },
    });
    note({ entity: 'LeaveOpeningBalance', legacyId, outcome: 'CREATED', newId: row.id });
  }

  // ── Payroll history: reproduced as LOCKED runs (immutable), payslips regenerated from the snapshot ──
  for (const p of data.payrollHistory) await loadPayrollPeriod(p);
  async function loadPayrollPeriod(p: CanonicalPayPeriod) {
    const legacyId = p.key;
    const existing = await mapped(prisma, 'PayrollRun', legacyId);
    if (existing) return note({ entity: 'PayrollRun', legacyId, outcome: 'SKIPPED_EXISTING', newId: existing });
    const missing = p.lines.filter((l) => !empIds.has(l.employeeLegacyId));
    if (missing.length) {
      return note({ entity: 'PayrollRun', legacyId, outcome: 'REJECTED', message: `${missing.length} employee(s) in this period were not migrated: ${missing.map((m) => m.employeeLegacyId).slice(0, 10).join(', ')}` });
    }
    try {
      const runId = await prisma.tx(
        async (tx) => {
          const clash = await tx.payrollPeriod.findUnique({ where: { tenantId_frequency_periodStart: { tenantId, frequency: p.frequency, periodStart: new Date(`${p.periodStart}T00:00:00Z`) } } });
          if (clash) throw new Error(`A ${p.frequency.toLowerCase()} period starting ${p.periodStart} already exists in the new system`);
          const period = await tx.payrollPeriod.create({
            data: { tenantId, frequency: p.frequency, periodStart: new Date(`${p.periodStart}T00:00:00Z`), periodEnd: new Date(`${p.periodEnd}T00:00:00Z`), payDate: new Date(`${p.payDate}T00:00:00Z`), status: 'CLOSED', closedAt: new Date() },
          });
          const run = await tx.payrollRun.create({
            data: {
              tenantId,
              periodId: period.id,
              runNumber: `LEGACY-${p.frequency[0]}${p.periodStart.replace(/-/g, '')}`,
              frequency: p.frequency,
              runType: 'REGULAR',
              notes: 'Historical payroll imported from the legacy YardHRMS (Google Sheets) export. Amounts reproduced, not recalculated.',
              createdById: actor.user.id,
              exceptions: [],
            },
          });
          let gross = new Prisma.Decimal(0), ded = new Prisma.Decimal(0), er = new Prisma.Decimal(0), net = new Prisma.Decimal(0);
          const snapshot: unknown[] = [];
          for (const l of p.lines) {
            const emp = await tx.employee.findUniqueOrThrow({ where: { id: empIds.get(l.employeeLegacyId)! }, include: { department: true, position: true } });
            const eeTotal = l.deductions.reduce((a, d) => a.plus(d.employee), new Prisma.Decimal(l.otherDeductions));
            const erTotal = l.deductions.reduce((a, d) => a.plus(d.employer), new Prisma.Decimal(0));
            const re = await tx.payrollRunEmployee.create({
              data: {
                tenantId,
                runId: run.id,
                employeeId: emp.id,
                employeeNumber: emp.employeeNumber,
                employeeName: `${emp.firstName} ${emp.lastName}`,
                departmentName: emp.department?.name ?? null,
                positionName: emp.position?.name ?? null,
                payFrequency: p.frequency,
                payType: emp.payType,
                trnMasked: emp.trnLast4 ? `•••••${emp.trnLast4}` : null,
                nisMasked: emp.nisLast4 ? `•••${emp.nisLast4}` : null,
                regularHours: new Prisma.Decimal(l.regularHours),
                overtimeHours: new Prisma.Decimal(l.overtimeHours),
                grossPay: new Prisma.Decimal(l.grossPay),
                taxableGross: new Prisma.Decimal(l.grossPay),
                totalDeductions: eeTotal,
                employerContributions: erTotal,
                netPay: new Prisma.Decimal(l.netPay),
                calculation: { legacy: true, source: 'legacy-yardhrms-export', note: 'Reproduced from the approved legacy payroll; not recalculated' },
                inputs: { legacyEmployeeId: l.employeeLegacyId },
                earnings: { create: [{ tenantId, code: 'LEGACY_GROSS', category: 'BASIC', description: 'Gross pay (legacy payroll)', amount: new Prisma.Decimal(l.grossPay), taxable: true }] },
                deductions: {
                  create: [
                    ...l.deductions.map((d) => ({ tenantId, code: d.code, description: STATUTORY_NAMES[d.code] ?? d.code, category: 'STATUTORY', statutory: true, employeeAmount: new Prisma.Decimal(d.employee), employerAmount: new Prisma.Decimal(d.employer) })),
                    ...(new Prisma.Decimal(l.otherDeductions).isZero() ? [] : [{ tenantId, code: 'LEGACY_OTHER', description: 'Other deductions (legacy payroll)', category: 'OTHER', statutory: false, employeeAmount: new Prisma.Decimal(l.otherDeductions) }]),
                  ],
                },
              },
            });
            gross = gross.plus(l.grossPay);
            ded = ded.plus(eeTotal);
            er = er.plus(erTotal);
            net = net.plus(l.netPay);
            snapshot.push({ e: re.employeeId, g: l.grossPay, n: l.netPay, d: l.deductions, o: l.otherDeductions });
          }
          const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
          const now = new Date();
          await tx.payrollRun.update({
            where: { id: run.id },
            data: { grossTotal: gross, deductionTotal: ded, employerTotal: er, netTotal: net, employeeCount: p.lines.length, status: 'APPROVED', snapshotHash: hash, preparedById: actor.user.id, preparedAt: now, reviewedById: actor.user.id, reviewedAt: now, approvedById: actor.user.id, approvedAt: now },
          });
          for (const re of await tx.payrollRunEmployee.findMany({ where: { runId: run.id } })) {
            await tx.payslip.create({ data: { tenantId, runId: run.id, runEmployeeId: re.id, employeeId: re.employeeId, payDate: period.payDate } });
          }
          await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'LOCKED', lockedById: actor.user.id, lockedAt: now } });
          await remember(tx, 'PayrollRun', legacyId, run.id);
          await auditMigration(tx, 'migration.payroll_run_imported', 'PayrollRun', run.id, { legacyId, employees: p.lines.length, gross: gross.toFixed(2), net: net.toFixed(2), snapshotHash: hash });
          return run.id;
        },
        { timeout: 300_000 },
      );
      await jobs.enqueue('payslips.generate', { tenantId, runId }, { tenantId, dedupeKey: `payslips:${runId}` });
      note({ entity: 'PayrollRun', legacyId, outcome: 'CREATED', newId: runId });
    } catch (err) {
      note({ entity: 'PayrollRun', legacyId, outcome: 'REJECTED', message: (err as Error).message.slice(0, 500) });
    }
  }
  opts.log(`Payroll history: ${report.summary.PayrollRun?.CREATED ?? 0} periods imported, ${report.summary.PayrollRun?.REJECTED ?? 0} rejected`);
  report.finishedAt = new Date().toISOString();
  await audit.record({ tenantId, action: 'migration.load_completed', entityType: 'Tenant', entityId: tenantId, actorUserId: actor.user.id, metadata: { summary: report.summary } } as any);
  return report;
}
