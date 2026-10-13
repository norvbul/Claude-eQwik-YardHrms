import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PayrollRun } from '@prisma/client';
import {
  ageOn,
  calculatePay,
  prorationFactor,
  summarize,
  workingDaysBetween,
  type EmployeePayInput,
  type PayResult,
  type ComponentYtd,
  PERIODS_PER_YEAR,
} from '@yardhrms/payroll-engine';
import type { PayrollRunCreateInput } from '@yardhrms/types';
import { AuditService } from '../audit/audit.service';
import type { TenantAuth } from '../auth/auth-context';
import { CryptoService } from '../common/crypto.service';
import { badRequest, businessRule, forbidden, invalidState, notFound, payrollLocked } from '../common/errors';
import { fullName, isoDay, toDate } from '../common/util';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { JobsService } from '../jobs/jobs.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { StatutoryService } from './statutory.service';

const D = Prisma.Decimal;

/** Start of the tax year containing `payDate` (tax year begins on the 1st of `startMonth`). */
export function taxYearStart(payDate: Date, startMonth: number): Date {
  const y = payDate.getUTCFullYear();
  const m = payDate.getUTCMonth() + 1;
  return new Date(Date.UTC(m >= startMonth ? y : y - 1, startMonth - 1, 1));
}

type YtdLine = { code: string; base: string; employeeAmount: string; employerAmount: string; periodThreshold?: string; periodCeiling?: string | null; periodYearFraction?: string };

const EDITABLE: PayrollRun['status'][] = ['DRAFT', 'PREPARED', 'REVIEWED'];

export interface RunException {
  employeeId: string;
  employeeNumber: string;
  name: string;
  message: string;
}

@Injectable()
export class PayrollService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly statutory: StatutoryService,
    private readonly crypto: CryptoService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationService,
  ) {}

  async getRun(tenantId: string, id: string, client: Tx | PrismaService = this.prisma) {
    const run = await client.payrollRun.findFirst({ where: { id, tenantId }, include: { period: true } });
    if (!run) throw notFound('Payroll run');
    return run;
  }

  presentRun(run: PayrollRun & { period?: { periodStart: Date; periodEnd: Date; payDate: Date; status: string } }) {
    return {
      ...run,
      grossTotal: run.grossTotal.toString(),
      deductionTotal: run.deductionTotal.toString(),
      employerTotal: run.employerTotal.toString(),
      netTotal: run.netTotal.toString(),
      periodStart: run.period ? isoDay(run.period.periodStart) : undefined,
      periodEnd: run.period ? isoDay(run.period.periodEnd) : undefined,
      payDate: run.period ? isoDay(run.period.payDate) : undefined,
      periodStatus: run.period?.status,
      complianceCertified: this.config.PAYROLL_COMPLIANCE_CERTIFIED && run.ruleVersionApproved,
    };
  }

  async list(tenantId: string, q: { page: number; pageSize: number; status?: string; frequency?: string }) {
    const where: Prisma.PayrollRunWhereInput = { tenantId };
    if (q.status) where.status = q.status as any;
    if (q.frequency) where.frequency = q.frequency as any;
    const [total, rows] = await Promise.all([
      this.prisma.payrollRun.count({ where }),
      this.prisma.payrollRun.findMany({ where, include: { period: true }, orderBy: [{ createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { items: rows.map((r) => this.presentRun(r)), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  /** PAY-001: create a run for a frequency/period, optionally limited to a department or employees. */
  async create(auth: TenantAuth, input: PayrollRunCreateInput) {
    if (input.payDate < input.periodStart) throw badRequest('Pay date cannot be before the period start');
    const run = await this.prisma.tx(async (tx) => {
      const start = toDate(input.periodStart);
      const end = toDate(input.periodEnd);
      let period = await tx.payrollPeriod.findUnique({ where: { tenantId_frequency_periodStart: { tenantId: auth.tenantId, frequency: input.frequency, periodStart: start } } });
      if (period && period.periodEnd.getTime() !== end.getTime()) throw businessRule(`A ${input.frequency.toLowerCase()} period starting ${input.periodStart} already exists ending ${isoDay(period.periodEnd)}`);
      if (!period) {
        const overlapping = await tx.payrollPeriod.findFirst({ where: { tenantId: auth.tenantId, frequency: input.frequency, periodStart: { lte: end }, periodEnd: { gte: start } } });
        if (overlapping) throw businessRule(`Overlaps the existing period ${isoDay(overlapping.periodStart)} – ${isoDay(overlapping.periodEnd)}`);
        period = await tx.payrollPeriod.create({ data: { tenantId: auth.tenantId, frequency: input.frequency, periodStart: start, periodEnd: end, payDate: toDate(input.payDate) } });
      }
      if (input.runType === 'REGULAR') {
        if (period.status === 'CLOSED') throw businessRule('This period is locked. Use a supplemental run for additional payments.');
        const prior = await tx.payrollRun.findMany({ where: { tenantId: auth.tenantId, periodId: period.id, runType: 'REGULAR' } });
        for (const p of prior) {
          const reversed = await tx.payrollRun.findFirst({ where: { tenantId: auth.tenantId, reversalOfRunId: p.id, status: 'LOCKED' } });
          if (!reversed) throw businessRule('A regular run already exists for this period. Reverse it before running a corrected revision.', { runId: p.id });
        }
      }
      const revision = (await tx.payrollRun.count({ where: { tenantId: auth.tenantId, periodId: period.id, runType: input.runType } })) + 1;
      const runNumber = `${input.frequency.slice(0, 1)}${input.periodStart.replace(/-/g, '')}-${input.runType.slice(0, 3)}-${revision}`;
      if (input.departmentId) {
        const d = await tx.department.findFirst({ where: { id: input.departmentId, tenantId: auth.tenantId } });
        if (!d) throw badRequest('Department not found');
      }
      const created = await tx.payrollRun.create({
        data: {
          tenantId: auth.tenantId,
          periodId: period.id,
          runNumber,
          frequency: input.frequency,
          runType: input.runType,
          revision,
          departmentId: input.departmentId ?? null,
          employeeFilter: input.employeeIds?.length ? input.employeeIds : undefined,
          notes: input.notes ?? null,
          createdById: auth.user.id,
        },
      });
      await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.run_created', entityType: 'PayrollRun', entityId: created.id, after: input }, tx);
      return created;
    });
    return this.presentRun(await this.getRun(auth.tenantId, run.id));
  }

  /**
   * Year-to-date statutory figures per employee and component from APPROVED/LOCKED runs paid earlier in
   * the same tax year (this run excluded). Reversal runs subtract what they reverse. Runs calculated before
   * cumulative support, and migrated legacy runs, fall back to the current version's periodised allowances.
   */
  private async buildYtd(
    tx: Tx,
    tenantId: string,
    run: PayrollRun & { period: { payDate: Date } },
    employeeIds: string[],
    rules: { components: { code: string; annualThreshold?: string | null; annualCeiling?: string | null; calculationMethod?: string }[] },
  ): Promise<Map<string, Record<string, ComponentYtd>>> {
    const out = new Map<string, Record<string, ComponentYtd>>();
    const cumulative = rules.components.filter((c) => c.calculationMethod === 'CUMULATIVE');
    if (!cumulative.length || !employeeIds.length) return out;
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { taxYearStartMonth: true } });
    const start = taxYearStart(run.period.payDate, tenant.taxYearStartMonth);
    const rows = await tx.payrollRunEmployee.findMany({
      where: {
        tenantId,
        employeeId: { in: employeeIds },
        runId: { not: run.id },
        run: { status: { in: ['APPROVED', 'LOCKED'] }, period: { payDate: { gte: start, lte: run.period.payDate } } },
      },
      include: { deductions: true, run: { select: { runType: true, frequency: true } } },
    });
    for (const r of rows) {
      const calc = (r.calculation ?? {}) as Record<string, any>;
      const sign = calc.reversalOf ? -1 : 1;
      const res = (calc.reversalOf ? calc.original : calc) as Record<string, any>;
      const ppy = PERIODS_PER_YEAR[r.run.frequency];
      const fallbackFraction = r.run.runType === 'SUPPLEMENTAL' ? 0 : 1 / ppy;
      const lines: YtdLine[] = Array.isArray(res?.statutory)
        ? res.statutory
        : r.deductions.filter((d) => d.statutory).map((d) => ({ code: d.code, base: (d.base ?? r.grossPay).toString(), employeeAmount: d.employeeAmount.toString(), employerAmount: d.employerAmount.toString() }));
      const ytd = out.get(r.employeeId) ?? {};
      for (const c of cumulative) {
        const l = lines.find((x) => x.code === c.code);
        if (!l) continue;
        const fraction = l.periodYearFraction != null ? Number(l.periodYearFraction) : fallbackFraction;
        const thr = l.periodThreshold != null ? new D(l.periodThreshold) : new D(c.annualThreshold || 0).times(fraction);
        const ceil = l.periodCeiling !== undefined ? (l.periodCeiling === null ? null : new D(l.periodCeiling)) : c.annualCeiling ? new D(c.annualCeiling).times(fraction) : null;
        const y = ytd[c.code] ?? { base: '0', employee: '0', employer: '0', thresholdAllowance: '0', ceilingAllowance: null, yearFraction: '0' };
        const add = (a: string, b: Prisma.Decimal.Value) => new D(a).plus(new D(b).times(sign)).toString();
        ytd[c.code] = {
          base: add(y.base, l.base),
          employee: add(y.employee, l.employeeAmount),
          employer: add(y.employer, l.employerAmount),
          thresholdAllowance: add(y.thresholdAllowance, thr),
          ceilingAllowance: ceil ? add(y.ceilingAllowance ?? '0', ceil) : y.ceilingAllowance,
          yearFraction: add(y.yearFraction, fraction),
        };
      }
      out.set(r.employeeId, ytd);
    }
    return out;
  }

  private async eligibleEmployees(tx: Tx, run: PayrollRun & { period: { periodStart: Date; periodEnd: Date } }) {
    const filter = (run.employeeFilter as string[] | null) ?? null;
    const adjustmentEmployees =
      run.runType === 'SUPPLEMENTAL' ? (await tx.payrollAdjustment.findMany({ where: { runId: run.id }, select: { employeeId: true } })).map((a) => a.employeeId) : null;
    return tx.employee.findMany({
      where: {
        tenantId: run.tenantId,
        deletedAt: null,
        payFrequency: run.frequency,
        hireDate: { lte: run.period.periodEnd },
        departmentId: run.departmentId ?? undefined,
        id: adjustmentEmployees ? { in: adjustmentEmployees } : filter ? { in: filter } : undefined,
        OR: [{ status: 'ACTIVE' }, { status: 'TERMINATED', terminationDate: { gte: run.period.periodStart } }],
      },
      include: { department: true, position: true, bankAccounts: { where: { deletedAt: null, isPrimary: true }, take: 1 } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  /**
   * PAY-002/003/004, AC-08: builds engine inputs from APPROVED timesheets, overtime and leave, recurring
   * allowances/deductions and run adjustments, calculates each employee and stores the snapshot.
   */
  async prepare(auth: TenantAuth, runId: string) {
    const result = await this.prisma.tx(
      async (tx) => {
        const run = await this.getRun(auth.tenantId, runId, tx);
        if (!['DRAFT', 'PREPARED', 'REVIEWED'].includes(run.status)) throw payrollLocked();
        if (run.runType === 'REVERSAL') throw businessRule('Reversal runs are generated automatically and cannot be recalculated');
        const version = await this.statutory.effectiveVersion(auth.tenantId, run.period.periodEnd, tx);
        if (!version) {
          throw businessRule(
            'No APPROVED statutory rule version is effective for this period. Complete and approve the statutory rules in Payroll Setup (requires verified Jamaican rates).',
            { reason: 'NO_APPROVED_STATUTORY_RULES' },
          );
        }
        const rules = this.statutory.toRuleSet(version);
        const freqCfg = await tx.payFrequencyConfig.findUnique({ where: { tenantId_frequency: { tenantId: auth.tenantId, frequency: run.frequency } } });
        if (!freqCfg || !freqCfg.active) throw businessRule(`${run.frequency} pay frequency is not configured or inactive`);
        const ppy = { [run.frequency]: freqCfg.periodsPerYear } as Record<string, number>;
        const pStart = isoDay(run.period.periodStart)!;
        const pEnd = isoDay(run.period.periodEnd)!;
        const holidays = (await tx.publicHoliday.findMany({ where: { tenantId: auth.tenantId, date: { gte: run.period.periodStart, lte: run.period.periodEnd } } })).map((h) => isoDay(h.date)!);
        const employees = await this.eligibleEmployees(tx, run);
        const adjustments = await tx.payrollAdjustment.findMany({ where: { runId: run.id } });

        // Clear previous calculation (allowed only while not approved; DB trigger enforces this too)
        await tx.payrollRunEmployee.deleteMany({ where: { runId: run.id } });

        const ytdByEmployee = await this.buildYtd(tx, auth.tenantId, run, employees.map((e) => e.id), rules);
        const results: { employee: (typeof employees)[number]; input: EmployeePayInput; res: PayResult; regularHours: string; overtimeHours: string }[] = [];
        const exceptions: RunException[] = [];
        for (const e of employees) {
          try {
            const supplemental = run.runType === 'SUPPLEMENTAL';
            const [timesheets, overtime, leave, allowances, deductions] = supplemental
              ? [[], [], [], [], []]
              : await Promise.all([
                  e.payType === 'HOURLY'
                    ? tx.timesheet.findMany({ where: { tenantId: auth.tenantId, employeeId: e.id, status: 'APPROVED', payrollRunId: null, workDate: { lte: run.period.periodEnd } } })
                    : Promise.resolve([]),
                  tx.overtimeRequest.findMany({ where: { tenantId: auth.tenantId, employeeId: e.id, status: 'APPROVED', payrollRunId: null, workDate: { lte: run.period.periodEnd } }, include: { rule: true } }),
                  tx.leaveRequest.findMany({
                    where: { tenantId: auth.tenantId, employeeId: e.id, status: 'APPROVED', startDate: { lte: run.period.periodEnd }, endDate: { gte: run.period.periodStart } },
                    include: { leaveType: true },
                  }),
                  tx.employeeAllowance.findMany({
                    where: { tenantId: auth.tenantId, employeeId: e.id, deletedAt: null, startDate: { lte: run.period.periodEnd }, OR: [{ endDate: null }, { endDate: { gte: run.period.periodStart } }] },
                    include: { allowanceType: true },
                  }),
                  tx.employeeDeduction.findMany({
                    where: { tenantId: auth.tenantId, employeeId: e.id, deletedAt: null, startDate: { lte: run.period.periodEnd }, OR: [{ endDate: null }, { endDate: { gte: run.period.periodStart } }] },
                    include: { deductionType: true },
                  }),
                ]);
            const myAdj = adjustments.filter((a) => a.employeeId === e.id);
            const regularHours = timesheets.reduce((acc, t) => acc.plus(t.regularHours), new D(0));
            const otHours = overtime.reduce((acc, o) => acc.plus(o.hours), new D(0));
            const leaveLines = leave
              .map((l) => {
                const s = isoDay(l.startDate)! < pStart ? pStart : isoDay(l.startDate)!;
                const en = isoDay(l.endDate)! > pEnd ? pEnd : isoDay(l.endDate)!;
                let days = workingDaysBetween(s, en, { holidays });
                if (l.halfDayStart && isoDay(l.startDate) === s) days -= 0.5;
                if (l.halfDayEnd && isoDay(l.endDate) === en && !(l.halfDayStart && s === en)) days -= 0.5;
                return { description: `${l.leaveType.name} ${s}${s !== en ? ` – ${en}` : ''}`, days: String(Math.max(0, days)), payPercent: l.payPercent.toString() };
              })
              .filter((l) => Number(l.days) > 0);
            const input: EmployeePayInput = {
              employeeId: e.id,
              payFrequency: e.payFrequency,
              payType: supplemental ? 'SALARY' : e.payType,
              salaryPerPeriod: supplemental ? '0' : e.salaryPerPeriod?.toString() ?? null,
              hourlyRate: supplemental ? null : e.hourlyRate?.toString() ?? null,
              standardHoursPerPeriod: (e.standardHoursOverride ?? freqCfg.standardHours).toString(),
              workingDaysPerPeriod: freqCfg.workingDays.toString(),
              approvedRegularHours: regularHours.toString(),
              prorationFactor:
                e.payType === 'SALARY' && !supplemental
                  ? String(prorationFactor(pStart, pEnd, isoDay(e.hireDate), isoDay(e.terminationDate), { holidays }))
                  : null,
              overtime: overtime.map((o) => ({ hours: o.hours.toString(), multiplier: o.multiplier.toString(), description: `${o.rule.name} (${isoDay(o.workDate)})` })),
              allowances: allowances.map((al) => ({ code: al.allowanceType.code, description: al.allowanceType.name, amount: al.amount.toString(), taxable: al.allowanceType.taxable })),
              oneOffEarnings: myAdj
                .filter((a) => a.kind !== 'DEDUCTION')
                .map((a) => ({
                  code: a.kind,
                  description: a.description,
                  amount: a.amount.toString(),
                  taxable: a.taxable,
                  category: a.kind === 'OTHER_EARNING' ? 'OTHER' : (a.kind as 'BONUS' | 'COMMISSION' | 'RETRO' | 'ALLOWANCE'),
                })),
              leave: leaveLines,
              voluntaryDeductions: [
                ...deductions.map((d) => {
                  const amt = d.balance && d.balance.lessThan(d.amount) ? d.balance : d.amount;
                  return { code: d.deductionType.code, description: d.deductionType.name + (d.reference ? ` (${d.reference})` : ''), amount: amt.toString(), category: d.deductionType.category, preTax: d.deductionType.preTax };
                }),
                ...myAdj.filter((a) => a.kind === 'DEDUCTION').map((a) => ({ code: 'ADJ', description: a.description, amount: a.amount.toString(), category: 'OTHER', preTax: a.preTax })),
              ].filter((d) => Number(d.amount) > 0),
              ageAtPeriodEnd: e.dateOfBirth ? ageOn(isoDay(e.dateOfBirth)!, pEnd) : null,
              statutoryExemptions: (e.statutoryExemptions as string[] | null) ?? [],
              ytd: ytdByEmployee.get(e.id),
              // A supplemental run pays extra in an already-counted period: no additional allowances.
              periodYearFraction: supplemental ? '0' : null,
            };
            if (!supplemental && e.payType === 'SALARY' && !e.salaryPerPeriod) throw new Error('Salary per period is not set');
            if (!supplemental && e.payType === 'HOURLY' && !e.hourlyRate) throw new Error('Hourly rate is not set');
            const res = calculatePay(input, rules, { periodsPerYear: ppy as any });
            // Record exactly which approved source records were paid so approval marks only those.
            const sources = { timesheets: timesheets.map((t) => t.id), overtime: overtime.map((o) => o.id), leave: leave.map((l) => l.id) };
            results.push({ employee: e, input: { ...input, _sources: sources } as EmployeePayInput, res, regularHours: regularHours.toString(), overtimeHours: otHours.toString() });
          } catch (err) {
            exceptions.push({ employeeId: e.id, employeeNumber: e.employeeNumber, name: fullName(e), message: (err as Error).message });
          }
        }

        for (const { employee: e, input, res, regularHours, overtimeHours } of results) {
          const bank = e.bankAccounts[0];
          const re = await tx.payrollRunEmployee.create({
            data: {
              tenantId: auth.tenantId,
              runId: run.id,
              employeeId: e.id,
              employeeNumber: e.employeeNumber,
              employeeName: fullName(e),
              departmentName: e.department?.name ?? null,
              positionName: e.position?.name ?? null,
              payFrequency: e.payFrequency,
              payType: e.payType,
              trnMasked: e.trnLast4 ? `•••••${e.trnLast4}` : null,
              nisMasked: e.nisLast4 ? `•••${e.nisLast4}` : null,
              bankName: bank?.bankName ?? null,
              bankAccountLast4: bank?.accountLast4 ?? null,
              regularHours: new D(regularHours),
              overtimeHours: new D(overtimeHours),
              hourlyEquivalent: new D(res.hourlyEquivalent),
              grossPay: new D(res.grossPay),
              taxableGross: new D(res.taxableGross),
              totalDeductions: new D(res.totalEmployeeDeductions),
              employerContributions: new D(res.totalEmployerContributions),
              netPay: new D(res.netPay),
              calculation: res as unknown as Prisma.InputJsonValue,
              inputs: input as unknown as Prisma.InputJsonValue,
              warnings: res.warnings.length ? res.warnings : undefined,
            },
          });
          await tx.payrollEarning.createMany({
            data: res.earnings.map((er) => ({
              tenantId: auth.tenantId,
              runEmployeeId: re.id,
              code: er.code,
              category: er.category,
              description: er.description.slice(0, 160),
              quantity: er.quantity ? new D(er.quantity) : null,
              rate: er.rate ? new D(er.rate) : null,
              amount: new D(er.amount),
              taxable: er.taxable,
            })),
          });
          await tx.payrollDeduction.createMany({
            data: [
              ...res.statutory.map((s) => ({
                tenantId: auth.tenantId,
                runEmployeeId: re.id,
                code: s.code,
                description: s.name,
                category: 'STATUTORY',
                statutory: true,
                base: new D(s.taxableAfterThreshold),
                employeeAmount: new D(s.employeeAmount),
                employerAmount: new D(s.employerAmount),
              })),
              ...res.voluntary.map((v) => ({
                tenantId: auth.tenantId,
                runEmployeeId: re.id,
                code: v.code,
                description: v.description.slice(0, 160),
                category: v.category.slice(0, 20),
                statutory: false,
                base: null,
                employeeAmount: new D(v.amount),
                employerAmount: new D(0),
              })),
            ],
          });
        }
        const totals = summarize(results.map((r) => r.res));
        await tx.payrollRun.update({
          where: { id: run.id },
          data: {
            status: 'PREPARED',
            ruleVersionId: version.id,
            ruleVersionApproved: version.status === 'APPROVED',
            grossTotal: new D(totals.gross),
            deductionTotal: new D(totals.employeeDeductions),
            employerTotal: new D(totals.employerContributions),
            netTotal: new D(totals.net),
            employeeCount: results.length,
            exceptions: exceptions.length ? (exceptions as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            preparedById: auth.user.id,
            preparedAt: new Date(),
            reviewedById: null,
            reviewedAt: null,
          },
        });
        await this.audit.record(
          { tenantId: auth.tenantId, action: 'payroll.run_prepared', entityType: 'PayrollRun', entityId: run.id, metadata: { ruleVersionId: version.id, totals, exceptions: exceptions.length } },
          tx,
        );
        await this.notifications.notify(tx, {
          tenantId: auth.tenantId,
          userIds: await this.notifications.usersWithPermission(tx, auth.tenantId, 'payroll.review'),
          excludeUserId: auth.user.id,
          category: 'payroll',
          type: 'payroll_review_requested',
          title: `Payroll ${run.runNumber} is ready for review`,
          body: `${auth.user.fullName} prepared ${run.frequency.toLowerCase()} payroll ${run.runNumber} (${isoDay(run.period.periodStart)} to ${isoDay(run.period.periodEnd)}, pay date ${isoDay(run.period.payDate)}): ${totals.employees} employee(s), net ${totals.net}${exceptions.length ? `, ${exceptions.length} exception(s)` : ''}.`,
          link: `/app/payroll/runs/${run.id}`,
          dedupeKey: `payroll:${run.id}:prepared:${Date.now()}`,
        });
        return { totals, exceptions };
      },
      { timeout: 120_000 },
    );
    return { run: this.presentRun(await this.getRun(auth.tenantId, runId)), ...result };
  }

  private async assertSeparation(tx: Tx, auth: TenantAuth, run: PayrollRun, stage: 'review' | 'approve') {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { requireSeparateApprover: true } });
    if (!tenant.requireSeparateApprover) return;
    if (run.preparedById === auth.user.id) throw forbidden(`Separation of duties: the person who prepared this payroll cannot ${stage} it`);
  }

  async review(auth: TenantAuth, runId: string, comment?: string | null) {
    await this.prisma.tx(async (tx) => {
      const run = await this.getRun(auth.tenantId, runId, tx);
      if (run.status !== 'PREPARED') throw invalidState(`Only PREPARED runs can be reviewed (current: ${run.status})`);
      await this.assertSeparation(tx, auth, run, 'review');
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'REVIEWED', reviewedById: auth.user.id, reviewedAt: new Date() } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.run_reviewed', entityType: 'PayrollRun', entityId: run.id, reason: comment ?? null }, tx);
      await this.notifications.notify(tx, {
        tenantId: auth.tenantId,
        userIds: (await this.notifications.usersWithPermission(tx, auth.tenantId, 'payroll.approve')).filter((u) => u !== run.preparedById),
        excludeUserId: auth.user.id,
        category: 'payroll',
        type: 'payroll_approval_requested',
        title: `Payroll ${run.runNumber} is ready for approval`,
        body: `${auth.user.fullName} reviewed payroll ${run.runNumber} (pay date ${isoDay(run.period.payDate)}, net ${run.netTotal.toFixed(2)}).${comment ? ` Comment: “${comment}”` : ''}`,
        link: `/app/payroll/runs/${run.id}`,
        dedupeKey: `payroll:${run.id}:reviewed:${Date.now()}`,
      });
    });
    return this.presentRun(await this.getRun(auth.tenantId, runId));
  }

  async reopen(auth: TenantAuth, runId: string, comment?: string | null) {
    await this.prisma.tx(async (tx) => {
      const run = await this.getRun(auth.tenantId, runId, tx);
      if (!['PREPARED', 'REVIEWED'].includes(run.status)) throw invalidState('Only prepared or reviewed runs can be returned to draft');
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'DRAFT', reviewedById: null, reviewedAt: null } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.run_reopened', entityType: 'PayrollRun', entityId: run.id, reason: comment ?? null }, tx);
    });
    return this.presentRun(await this.getRun(auth.tenantId, runId));
  }

  private canonicalSnapshot(rows: { employeeId: string; grossPay: Prisma.Decimal; netPay: Prisma.Decimal; totalDeductions: Prisma.Decimal; employerContributions: Prisma.Decimal; calculation: unknown }[]) {
    return JSON.stringify(
      rows
        .map((r) => ({ e: r.employeeId, g: r.grossPay.toString(), n: r.netPay.toString(), d: r.totalDeductions.toString(), er: r.employerContributions.toString(), c: r.calculation }))
        .sort((a, b) => a.e.localeCompare(b.e)),
    );
  }

  /** PAY-007/008: approval freezes the calculation snapshot (hash recorded; DB triggers block edits). */
  async approve(auth: TenantAuth, runId: string, comment?: string | null) {
    await this.prisma.tx(
      async (tx) => {
        const run = await this.getRun(auth.tenantId, runId, tx);
        if (run.status !== 'REVIEWED') throw invalidState(`Only REVIEWED runs can be approved (current: ${run.status})`);
        await this.assertSeparation(tx, auth, run, 'approve');
        const rows = await tx.payrollRunEmployee.findMany({ where: { runId: run.id } });
        if (!rows.length) throw businessRule('This run has no calculated employees');
        if (run.runType !== 'REVERSAL') {
          const version = run.ruleVersionId ? await tx.statutoryRuleVersion.findUnique({ where: { id: run.ruleVersionId } }) : null;
          if (!version || version.status !== 'APPROVED') throw businessRule('The statutory rule version used by this run is no longer approved. Re-prepare the run.');
        }
        const hash = this.crypto.sha256(this.canonicalSnapshot(rows));
        // Mark consumed inputs so they are not paid twice.
        if (run.runType === 'REGULAR') {
          for (const r of rows) {
            const inputs = r.inputs as any;
            const src = (inputs?._sources ?? { timesheets: [], overtime: [], leave: [] }) as { timesheets: string[]; overtime: string[]; leave: string[] };
            if (src.timesheets.length) {
              const n = await tx.timesheet.updateMany({ where: { tenantId: auth.tenantId, id: { in: src.timesheets }, status: 'APPROVED', payrollRunId: null }, data: { payrollRunId: run.id } });
              if (n.count !== src.timesheets.length) throw invalidState(`Timesheets for ${r.employeeName} changed since preparation. Re-prepare the run.`);
            }
            if (src.overtime.length) {
              const n = await tx.overtimeRequest.updateMany({ where: { tenantId: auth.tenantId, id: { in: src.overtime }, status: 'APPROVED', payrollRunId: null }, data: { payrollRunId: run.id } });
              if (n.count !== src.overtime.length) throw invalidState(`Overtime for ${r.employeeName} changed since preparation. Re-prepare the run.`);
            }
            if (src.leave.length) {
              await tx.leaveRequest.updateMany({ where: { tenantId: auth.tenantId, id: { in: src.leave }, status: 'APPROVED', payrollRunId: null }, data: { payrollRunId: run.id } });
            }
            for (const vd of (inputs?.voluntaryDeductions ?? []) as { code: string; amount: string }[]) {
              const loan = await tx.employeeDeduction.findFirst({ where: { tenantId: auth.tenantId, employeeId: r.employeeId, deletedAt: null, balance: { not: null }, deductionType: { code: vd.code } } });
              if (loan?.balance) await tx.employeeDeduction.update({ where: { id: loan.id }, data: { balance: Prisma.Decimal.max(new D(0), loan.balance.minus(new D(vd.amount))) } });
            }
          }
        }
        const res = await tx.payrollRun.updateMany({ where: { id: run.id, status: 'REVIEWED' }, data: { status: 'APPROVED', approvedById: auth.user.id, approvedAt: new Date(), snapshotHash: hash } });
        if (res.count !== 1) throw invalidState('Run was changed concurrently');
        if (run.runType !== 'REVERSAL') {
          for (const r of rows) {
            await tx.payslip.create({ data: { tenantId: auth.tenantId, runId: run.id, runEmployeeId: r.id, employeeId: r.employeeId, payDate: run.period.payDate } });
          }
        }
        await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.run_approved', entityType: 'PayrollRun', entityId: run.id, reason: comment ?? null, metadata: { snapshotHash: hash, employees: rows.length } }, tx);
        await this.notifications.notify(tx, {
          tenantId: auth.tenantId,
          userIds: [run.preparedById, run.reviewedById],
          excludeUserId: auth.user.id,
          category: 'payroll',
          type: 'payroll_approved',
          title: `Payroll ${run.runNumber} approved`,
          body: `${auth.user.fullName} approved payroll ${run.runNumber}. Payslips are being issued; lock the run once bank payments are made.`,
          link: `/app/payroll/runs/${run.id}`,
          dedupeKey: `payroll:${run.id}:approved`,
        });
        if (run.runType !== 'REVERSAL') {
          const members = await tx.tenantMembership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE', employeeId: { in: rows.map((r) => r.employeeId) } }, select: { userId: true } });
          await this.notifications.notify(tx, {
            tenantId: auth.tenantId,
            userIds: members.map((m) => m.userId),
            category: 'payslips',
            type: 'payslip_available',
            title: 'Your payslip is available',
            body: `Your payslip for pay date ${isoDay(run.period.payDate)} is ready to view in eQwik YardHRMS. For your security, payslips are not attached to emails.`,
            link: '/app/payslips',
            dedupeKey: `payslip:${run.id}`,
          });
        }
      },
      { timeout: 120_000 },
    );
    if ((await this.getRun(auth.tenantId, runId)).runType !== 'REVERSAL') await this.jobs.enqueue('payslips.generate', { tenantId: auth.tenantId, runId }, { tenantId: auth.tenantId, dedupeKey: `payslips:${runId}` });
    return this.presentRun(await this.getRun(auth.tenantId, runId));
  }

  /** Locks the run and closes the pay period for further timesheet/leave/overtime changes. */
  async lock(auth: TenantAuth, runId: string) {
    await this.prisma.tx(async (tx) => {
      const run = await this.getRun(auth.tenantId, runId, tx);
      if (run.status !== 'APPROVED') throw invalidState(`Only APPROVED runs can be locked (current: ${run.status})`);
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'LOCKED', lockedById: auth.user.id, lockedAt: new Date() } });
      if (run.runType === 'REGULAR') await tx.payrollPeriod.update({ where: { id: run.periodId }, data: { status: 'CLOSED', closedAt: new Date() } });
      if (run.runType === 'REVERSAL' && run.reversalOfRunId) {
        // Release inputs of the reversed run so a corrected revision can include them, and reopen the period.
        await tx.timesheet.updateMany({ where: { tenantId: auth.tenantId, payrollRunId: run.reversalOfRunId }, data: { payrollRunId: null } });
        await tx.overtimeRequest.updateMany({ where: { tenantId: auth.tenantId, payrollRunId: run.reversalOfRunId }, data: { payrollRunId: null } });
        await tx.leaveRequest.updateMany({ where: { tenantId: auth.tenantId, payrollRunId: run.reversalOfRunId }, data: { payrollRunId: null } });
        const original = await tx.payrollRun.findUniqueOrThrow({ where: { id: run.reversalOfRunId } });
        if (original.runType === 'REGULAR') await tx.payrollPeriod.update({ where: { id: run.periodId }, data: { status: 'OPEN', closedAt: null } });
      }
      await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.run_locked', entityType: 'PayrollRun', entityId: run.id }, tx);
    });
    return this.presentRun(await this.getRun(auth.tenantId, runId));
  }

  /**
   * AC-09 / PAY-008: corrections never edit a locked run. A REVERSAL run with negated snapshot lines is
   * created and must itself be reviewed, approved and locked; the original stays immutable.
   */
  async reverse(auth: TenantAuth, runId: string, reason: string) {
    const id = await this.prisma.tx(
      async (tx) => {
        const run = await this.getRun(auth.tenantId, runId, tx);
        if (run.status !== 'LOCKED') throw invalidState('Only locked runs can be reversed');
        if (run.runType === 'REVERSAL') throw businessRule('A reversal run cannot itself be reversed');
        const existing = await tx.payrollRun.findFirst({ where: { tenantId: auth.tenantId, reversalOfRunId: run.id } });
        if (existing) throw invalidState('This run already has a reversal', { reversalRunId: existing.id });
        const revision = (await tx.payrollRun.count({ where: { tenantId: auth.tenantId, periodId: run.periodId, runType: 'REVERSAL' } })) + 1;
        const rows = await tx.payrollRunEmployee.findMany({ where: { runId: run.id }, include: { earnings: true, deductions: true } });
        const neg = (d: Prisma.Decimal) => d.negated();
        const rev = await tx.payrollRun.create({
          data: {
            tenantId: auth.tenantId,
            periodId: run.periodId,
            runNumber: `${run.runNumber}-REV${revision}`,
            frequency: run.frequency,
            runType: 'REVERSAL',
            revision,
            status: 'PREPARED',
            ruleVersionId: run.ruleVersionId,
            ruleVersionApproved: run.ruleVersionApproved,
            grossTotal: neg(run.grossTotal),
            deductionTotal: neg(run.deductionTotal),
            employerTotal: neg(run.employerTotal),
            netTotal: neg(run.netTotal),
            employeeCount: run.employeeCount,
            reversalOfRunId: run.id,
            notes: `Reversal of ${run.runNumber}: ${reason}`.slice(0, 500),
            createdById: auth.user.id,
            preparedById: auth.user.id,
            preparedAt: new Date(),
          },
        });
        for (const r of rows) {
          const { id: _id, runId: _r, createdAt: _c, earnings, deductions, ...rest } = r;
          const re = await tx.payrollRunEmployee.create({
            data: {
              ...rest,
              runId: rev.id,
              grossPay: neg(r.grossPay),
              taxableGross: neg(r.taxableGross),
              totalDeductions: neg(r.totalDeductions),
              employerContributions: neg(r.employerContributions),
              netPay: neg(r.netPay),
              regularHours: neg(r.regularHours),
              overtimeHours: neg(r.overtimeHours),
              calculation: { reversalOf: run.id, original: r.calculation } as Prisma.InputJsonValue,
              inputs: r.inputs as Prisma.InputJsonValue,
              warnings: Prisma.DbNull,
            },
          });
          await tx.payrollEarning.createMany({
            data: earnings.map(({ id: _i, runEmployeeId: _x, ...e }) => ({ ...e, runEmployeeId: re.id, amount: neg(e.amount), quantity: e.quantity ? neg(e.quantity) : null })),
          });
          await tx.payrollDeduction.createMany({
            data: deductions.map(({ id: _i, runEmployeeId: _x, ...d }) => ({ ...d, runEmployeeId: re.id, employeeAmount: neg(d.employeeAmount), employerAmount: neg(d.employerAmount), base: d.base ? neg(d.base) : null })),
          });
        }
        await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.run_reversal_created', entityType: 'PayrollRun', entityId: rev.id, reason, metadata: { reversalOf: run.id } }, tx);
        return rev.id;
      },
      { timeout: 120_000 },
    );
    return this.presentRun(await this.getRun(auth.tenantId, id));
  }

  async remove(auth: TenantAuth, runId: string) {
    await this.prisma.tx(async (tx) => {
      const run = await this.getRun(auth.tenantId, runId, tx);
      if (!EDITABLE.includes(run.status)) throw payrollLocked();
      await tx.timesheet.updateMany({ where: { tenantId: auth.tenantId, payrollRunId: run.id }, data: { payrollRunId: null } });
      await tx.payrollRun.delete({ where: { id: run.id } });
      const remaining = await tx.payrollRun.count({ where: { periodId: run.periodId } });
      if (!remaining) await tx.payrollPeriod.delete({ where: { id: run.periodId } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.run_deleted', entityType: 'PayrollRun', entityId: run.id, before: { runNumber: run.runNumber, status: run.status } }, tx);
    });
    return { deleted: true };
  }

  async addAdjustment(auth: TenantAuth, runId: string, input: { employeeId: string; kind: any; description: string; amount: string; taxable: boolean; preTax: boolean }) {
    return this.prisma.tx(async (tx) => {
      const run = await this.getRun(auth.tenantId, runId, tx);
      if (!EDITABLE.includes(run.status)) throw payrollLocked();
      if (run.runType === 'REVERSAL') throw businessRule('Reversal runs cannot take adjustments');
      const e = await tx.employee.findFirst({ where: { id: input.employeeId, tenantId: auth.tenantId, deletedAt: null } });
      if (!e) throw badRequest('Employee not found');
      if (e.payFrequency !== run.frequency) throw businessRule(`Employee is paid ${e.payFrequency.toLowerCase()}, not ${run.frequency.toLowerCase()}`);
      const adj = await tx.payrollAdjustment.create({
        data: { tenantId: auth.tenantId, runId: run.id, employeeId: e.id, kind: input.kind, description: input.description, amount: new D(input.amount), taxable: input.taxable, preTax: input.preTax, createdById: auth.user.id },
      });
      if (run.status !== 'DRAFT') await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'DRAFT', reviewedById: null, reviewedAt: null } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.adjustment_added', entityType: 'PayrollAdjustment', entityId: adj.id, subjectEmployeeId: e.id, after: input }, tx);
      return adj;
    });
  }

  async removeAdjustment(auth: TenantAuth, runId: string, adjustmentId: string) {
    return this.prisma.tx(async (tx) => {
      const run = await this.getRun(auth.tenantId, runId, tx);
      if (!EDITABLE.includes(run.status)) throw payrollLocked();
      const adj = await tx.payrollAdjustment.findFirst({ where: { id: adjustmentId, runId: run.id, tenantId: auth.tenantId } });
      if (!adj) throw notFound('Adjustment');
      await tx.payrollAdjustment.delete({ where: { id: adj.id } });
      if (run.status !== 'DRAFT') await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'DRAFT', reviewedById: null, reviewedAt: null } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.adjustment_removed', entityType: 'PayrollAdjustment', entityId: adj.id, subjectEmployeeId: adj.employeeId, before: adj }, tx);
      return { deleted: true };
    });
  }

  async detail(tenantId: string, runId: string) {
    const run = await this.getRun(tenantId, runId);
    const [employees, adjustments, reversal] = await Promise.all([
      this.prisma.payrollRunEmployee.findMany({ where: { runId }, include: { earnings: true, deductions: true, payslip: { select: { id: true, generatedAt: true } } }, orderBy: { employeeName: 'asc' } }),
      this.prisma.payrollAdjustment.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.payrollRun.findFirst({ where: { tenantId, reversalOfRunId: runId }, select: { id: true, runNumber: true, status: true } }),
    ]);
    const userIds = [run.createdById, run.preparedById, run.reviewedById, run.approvedById, run.lockedById].filter(Boolean) as string[];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } });
    const name = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? null;
    const version = run.ruleVersionId ? await this.prisma.statutoryRuleVersion.findUnique({ where: { id: run.ruleVersionId }, select: { id: true, name: true, status: true } }) : null;
    return {
      run: { ...this.presentRun(run), createdBy: name(run.createdById), preparedBy: name(run.preparedById), reviewedBy: name(run.reviewedById), approvedBy: name(run.approvedById), lockedBy: name(run.lockedById) },
      ruleVersion: version,
      reversal,
      adjustments,
      employees: employees.map((e) => ({
        ...e,
        inputs: undefined,
        payslipId: e.payslip?.id ?? null,
      })),
    };
  }
}
