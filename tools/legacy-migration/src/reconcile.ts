import { Prisma } from '@prisma/client';
import type { PrismaService } from '@yardhrms/api/dist/prisma/prisma.service';
import type { CanonicalDataset } from './transform';

export interface Check { check: string; subject: string; expected: string; actual: string; ok: boolean }
export interface ReconcileReport { tenantId: string; generatedAt: string; passed: boolean; checks: Check[]; licences: LicenceRecon[] }
export interface LicenceRecon { installationId: string | null; companyName: string; legacyType: string | null; legacyExpiry: string | null; matchedTenant: string | null; currentPlan: string | null; currentStatus: string | null; action: string }

/**
 * PRD §14 "Validate": compares the migrated tenant against the canonical dataset produced from the
 * legacy export — record counts, employee profile fields, leave balances, payroll totals per period and
 * historical payslip availability — and produces the licence reconciliation report for Qwik staff.
 */
export async function reconcile(prisma: PrismaService, tenantId: string, data: CanonicalDataset): Promise<ReconcileReport> {
  const checks: Check[] = [];
  const add = (check: string, subject: string, expected: unknown, actual: unknown) => checks.push({ check, subject, expected: String(expected), actual: String(actual), ok: String(expected) === String(actual) });
  const maps = await prisma.legacyIdMap.findMany({ where: { tenantId } });
  const idOf = (type: string, legacyId: string) => maps.find((m) => m.entityType === type && m.legacyId === legacyId)?.newId ?? null;

  for (const [type, list] of [['Department', data.departments], ['Branch', data.branches], ['Position', data.positions], ['Employee', data.employees], ['PayrollRun', data.payrollHistory]] as const) {
    add('record count', type, list.length, maps.filter((m) => m.entityType === type).length);
  }

  // Employee profiles: every migrated employee, key fields
  for (const e of data.employees) {
    const id = idOf('Employee', e.legacyId);
    const row = id ? await prisma.employee.findUnique({ where: { id } }) : null;
    if (!row) {
      add('employee migrated', e.legacyId, 'present', 'missing');
      continue;
    }
    const actual = [row.firstName, row.lastName, row.hireDate.toISOString().slice(0, 10), row.payFrequency, row.payType, row.salaryPerPeriod?.toFixed(2) ?? row.hourlyRate?.toFixed(2) ?? '', row.status].join('|');
    const expected = [e.firstName, e.lastName, e.hireDate, e.payFrequency, e.payType, e.salaryPerPeriod ?? (e.hourlyRate ? Number(e.hourlyRate).toFixed(2) : ''), e.status].join('|');
    add('employee profile', e.legacyId, expected, actual);
  }

  // Leave balances: opening entry equals the legacy balance as at its as-of date
  for (const b of data.leaveBalances) {
    const employeeId = idOf('Employee', b.employeeLegacyId);
    const lt = await prisma.leaveType.findFirst({ where: { tenantId, code: b.leaveTypeCode } });
    const entry = employeeId && lt ? await prisma.leaveLedgerEntry.findFirst({ where: { tenantId, employeeId, leaveTypeId: lt.id, postingKey: 'legacy-opening' } }) : null;
    add('leave opening balance', `${b.employeeLegacyId}/${b.leaveTypeCode}`, Number(b.days).toFixed(2), entry ? entry.days.toFixed(2) : 'missing');
  }

  // Payroll totals per period + payslip availability
  for (const p of data.payrollHistory) {
    const runId = idOf('PayrollRun', p.key);
    const run = runId ? await prisma.payrollRun.findUnique({ where: { id: runId } }) : null;
    const sum = (f: (l: (typeof p.lines)[number]) => string) => p.lines.reduce((a, l) => a.plus(f(l)), new Prisma.Decimal(0)).toFixed(2);
    add('payroll gross total', p.key, sum((l) => l.grossPay), run?.grossTotal.toFixed(2) ?? 'missing');
    add('payroll net total', p.key, sum((l) => l.netPay), run?.netTotal.toFixed(2) ?? 'missing');
    add('payroll employee count', p.key, p.lines.length, run?.employeeCount ?? 'missing');
    add('payroll run locked', p.key, 'LOCKED', run?.status ?? 'missing');
    if (run) add('payslips generated', p.key, p.lines.length, await prisma.payslip.count({ where: { runId: run.id, storageKey: { not: null } } }));
  }

  // Licence reconciliation: informational; paid plans are activated only through the Licence Manager
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { currentSubscription: { include: { plan: true } } } });
  const licences: LicenceRecon[] = data.licences.map((l) => {
    const sub = t?.currentSubscription;
    const sameCompany = !!t && (t.displayName.toLowerCase() === l.companyName.toLowerCase() || t.legalName.toLowerCase().startsWith(l.companyName.toLowerCase()));
    const paid = l.licenceType && !/free/i.test(l.licenceType);
    return {
      installationId: l.installationId,
      companyName: l.companyName,
      legacyType: l.licenceType,
      legacyExpiry: l.expiresOn,
      matchedTenant: sameCompany ? t!.displayName : null,
      currentPlan: sub?.plan?.name ?? null,
      currentStatus: sub?.status ?? null,
      action: !sameCompany
        ? 'No matching tenant: confirm the customer and create/link the company before conversion'
        : paid
          ? 'Record the verified payment (or a reasoned commercial override) in the Licence Manager and activate the matching plan; legacy InstallationIDs are not used'
          : 'Free tier: no action needed',
    };
  });

  return { tenantId, generatedAt: new Date().toISOString(), passed: checks.every((c) => c.ok), checks, licences };
}
