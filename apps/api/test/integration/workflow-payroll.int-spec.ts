import { Prisma } from '@prisma/client';
import { TestContext, addMember, approvedSyntheticRules, bootstrap, employeeBody, registerTenant, upgradeTenant } from './helpers';

/** Last complete calendar month (so timesheet dates are in the past). */
function lastMonth() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  // first Monday of that month for weekly periods
  const firstMonday = new Date(start);
  while (firstMonday.getUTCDay() !== 1) firstMonday.setUTCDate(firstMonday.getUTCDate() + 1);
  const weekEnd = new Date(firstMonday.getTime() + 6 * 86400000);
  return { start: iso(start), end: iso(end), monday: iso(firstMonday), sunday: iso(weekEnd), tuesday: iso(new Date(firstMonday.getTime() + 86400000)) };
}

describe('Timesheets, overtime, leave and payroll', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await bootstrap();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('AC-06: monthly employees cannot submit regular timesheets; monthly payroll uses the configured 173.33 hours', async () => {
    const t = await registerTenant(ctx);
    const monthly = await t.admin.post('/employees', employeeBody({ payFrequency: 'MONTHLY' }));
    const res = await t.admin.post('/timesheets', { employeeId: monthly.body.data.id, workDate: lastMonth().monday, startTime: '08:00', endTime: '16:00', breakHours: '0.5' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.reason).toBe('MONTHLY_TIMESHEET_NOT_ALLOWED');
    const settings = await t.admin.get('/settings/payroll');
    expect(settings.body.data.items.find((i: any) => i.frequency === 'MONTHLY').standardHours).toBe('173.33');
  });

  it('validates timesheet hours, overnight shifts, duplicates and overlaps', async () => {
    const t = await registerTenant(ctx);
    const e = await t.admin.post('/employees', employeeBody({ payFrequency: 'WEEKLY', payType: 'HOURLY', hourlyRate: '1000.00', salaryPerPeriod: null }));
    const id = e.body.data.id;
    const d = lastMonth();
    const night = await t.admin.post('/timesheets', { employeeId: id, workDate: d.monday, startTime: '22:00', endTime: '06:00', breakHours: '1' });
    expect(night.status).toBe(201);
    expect(night.body.data.overnight).toBe(true);
    expect(night.body.data.regularHours).toBe('7');
    // overlaps the overnight shift spilling into Tuesday morning
    const overlap = await t.admin.post('/timesheets', { employeeId: id, workDate: d.tuesday, startTime: '05:00', endTime: '09:00', breakHours: '0' });
    expect(overlap.status).toBe(409);
    const dup = await t.admin.post('/timesheets', { employeeId: id, workDate: d.monday, startTime: '22:00', endTime: '06:00', breakHours: '1' });
    expect(dup.status).toBe(409);
    const tooLong = await t.admin.post('/timesheets', { employeeId: id, workDate: d.tuesday, startTime: '06:00', endTime: '23:30', breakHours: '0' });
    expect(tooLong.status).toBe(422);
    const negativeBreak = await t.admin.post('/timesheets', { employeeId: id, workDate: d.tuesday, startTime: '08:00', endTime: '09:00', breakHours: '2' });
    expect(negativeBreak.status).toBe(400);
    const future = await t.admin.post('/timesheets', { employeeId: id, workDate: '2099-01-01', startTime: '08:00', endTime: '16:00' });
    expect(future.status).toBe(422);
  });

  it('AC-07: delegated submission stores the employee as subject and the actor separately; approval policy unchanged', async () => {
    const t = await registerTenant(ctx);
    await upgradeTenant(ctx, t.tenantId);
    const worker = await t.admin.post('/employees', employeeBody({ payFrequency: 'WEEKLY', payType: 'HOURLY', hourlyRate: '1000.00', salaryPerPeriod: null }));
    const mgrEmp = await t.admin.post('/employees', employeeBody({ firstName: 'Manny' }));
    const manager = await addMember(ctx, t.tenantId, ['MANAGER'], mgrEmp.body.data.id);
    const payrollOfficer = await addMember(ctx, t.tenantId, ['PAYROLL_OFFICER']);
    const d = lastMonth();
    const ts = await manager.client.post('/timesheets', { employeeId: worker.body.data.id, workDate: d.monday, startTime: '08:00', endTime: '16:30', breakHours: '0.5' });
    expect(ts.status).toBe(201);
    const row = await ctx.prisma.timesheet.findUniqueOrThrow({ where: { id: ts.body.data.id } });
    expect(row.employeeId).toBe(worker.body.data.id);
    expect(row.submittedByUserId).toBe(manager.userId);
    expect(row.delegated).toBe(true);
    expect(row.status).toBe('PENDING');
    const audit = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { entityId: row.id, action: 'timesheet.submitted_delegated' } });
    expect(audit.actorUserId).toBe(manager.userId);
    expect(audit.subjectEmployeeId).toBe(worker.body.data.id);
    // Delegated submission does not grant approval: Payroll Officer can submit but not approve
    const po = await payrollOfficer.client.post('/timesheets', { employeeId: worker.body.data.id, workDate: d.tuesday, startTime: '08:00', endTime: '12:00' });
    expect(po.status).toBe(201);
    expect((await payrollOfficer.client.post(`/timesheets/${po.body.data.id}/approve`, {})).status).toBe(403);
    // Separation of duties: the manager cannot approve the record they submitted
    expect((await manager.client.post(`/timesheets/${ts.body.data.id}/approve`, {})).status).toBe(403);
    expect((await t.admin.post(`/timesheets/${ts.body.data.id}/approve`, {})).status).toBe(200);
    // Employees can only submit for themselves
    const selfEmp = await t.admin.post('/employees', employeeBody({ firstName: 'Selfie' }));
    const { client: emp } = await addMember(ctx, t.tenantId, ['EMPLOYEE'], selfEmp.body.data.id);
    expect((await emp.post('/timesheets', { employeeId: worker.body.data.id, workDate: d.tuesday, startTime: '13:00', endTime: '15:00' })).status).toBe(403);
  });

  it('leave: working days exclude weekends/holidays, balances enforced, approval posts to the ledger', async () => {
    const t = await registerTenant(ctx);
    const e = await t.admin.post('/employees', employeeBody());
    const types = await t.admin.get('/leave/types');
    const vac = types.body.data.find((x: any) => x.code === 'VAC');
    await t.admin.post('/master-data/public-holidays', { date: '2026-08-06', name: 'Independence Day' });
    const wd = await t.admin.get('/leave/working-days?start=2026-08-03&end=2026-08-09');
    expect(wd.body.data.workingDays).toBe(4);
    await t.admin.post('/leave/policies', { leaveTypeId: vac.id, annualEntitlementDays: '10', accrualMethod: 'ANNUAL_GRANT', carryForwardMaxDays: '5', effectiveFrom: '2025-01-01' });
    const over = await t.admin.post('/leave/requests', { employeeId: e.body.data.id, leaveTypeId: vac.id, startDate: '2026-08-03', endDate: '2026-08-07' });
    expect(over.status).toBe(422); // no balance granted yet
    await t.admin.post('/leave/adjustments', { employeeId: e.body.data.id, leaveTypeId: vac.id, entryType: 'OPENING', days: '6', effectiveDate: '2026-01-01', reason: 'Opening balance' });
    const ok = await t.admin.post('/leave/requests', { employeeId: e.body.data.id, leaveTypeId: vac.id, startDate: '2026-08-03', endDate: '2026-08-07' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.workingDays).toBe('4');
    const overlap = await t.admin.post('/leave/requests', { employeeId: e.body.data.id, leaveTypeId: vac.id, startDate: '2026-08-05', endDate: '2026-08-05' });
    expect(overlap.status).toBe(409);
    const hr = await addMember(ctx, t.tenantId, ['HR_OFFICER']);
    expect((await hr.client.post(`/leave/requests/${ok.body.data.id}/approve`, { comment: 'Enjoy' })).status).toBe(200);
    const bal = await t.admin.get(`/leave/balances?employeeId=${e.body.data.id}`);
    expect(bal.body.data.find((b: any) => b.leaveTypeCode === 'VAC').balance).toBe('2.00');
    const ledger = await ctx.prisma.leaveLedgerEntry.findMany({ where: { employeeId: e.body.data.id } });
    expect(ledger.map((l) => l.entryType).sort()).toEqual(['OPENING', 'USAGE']);
    // ledger is append-only at the database level
    await expect(ctx.prisma.leaveLedgerEntry.update({ where: { id: ledger[0].id }, data: { days: new Prisma.Decimal(99) } })).rejects.toThrow(/append-only/);
  });

  it('AC-08/AC-09/AC-10: payroll lifecycle with snapshot, immutability, reversal and audited payslip printing', async () => {
    const t = await registerTenant(ctx);
    await upgradeTenant(ctx, t.tenantId);
    const d = lastMonth();
    const payroll = await addMember(ctx, t.tenantId, ['PAYROLL_OFFICER']);
    const finance = await addMember(ctx, t.tenantId, ['FINANCE_APPROVER']);
    const ruleVersionId = await approvedSyntheticRules(ctx, payroll.client, finance.client);
    // statutory author cannot approve own version
    const selfApprove = await payroll.client.post('/payroll/statutory-versions', {
      name: 'Draft x',
      effectiveFrom: '2026-01-01',
      components: [{ code: 'X', name: 'Extra', sortOrder: 1, base: 'GROSS', employeeRate: '0.01', employerRate: '0', brackets: [] }],
    });
    expect(selfApprove.status).toBe(201);
    expect((await payroll.client.post(`/payroll/statutory-versions/${selfApprove.body.data.id}/approve`, { attestation: 'Self approval attempt should fail.' })).status).toBe(403);

    const monthly = await t.admin.post('/employees', employeeBody({ payFrequency: 'MONTHLY', salaryPerPeriod: '173330.00', overtimeEligible: true, firstName: 'Monty' }));
    const mid = monthly.body.data.id;
    const otRule = await t.admin.post('/overtime/rules', { code: 'OT15', name: 'Overtime', multiplier: '1.5' });
    const ot = await payroll.client.post('/overtime', { employeeId: mid, workDate: d.monday, hours: '4', overtimeRuleId: otRule.body.data.id, reason: 'Stock count' });
    expect(ot.status).toBe(201);
    expect((await t.admin.post(`/overtime/${ot.body.data.id}/approve`, {})).status).toBe(200);
    const unpaid = (await t.admin.get('/leave/types')).body.data.find((x: any) => x.code === 'UNPD');
    const lv = await payroll.client.post('/leave/requests', { employeeId: mid, leaveTypeId: unpaid.id, startDate: d.tuesday, endDate: d.tuesday });
    expect(lv.status).toBe(201);
    expect((await t.admin.post(`/leave/requests/${lv.body.data.id}/approve`, {})).status).toBe(200);
    // pending overtime must not enter payroll
    const pendingOt = await payroll.client.post('/overtime', { employeeId: mid, workDate: d.tuesday, hours: '2', overtimeRuleId: otRule.body.data.id, reason: 'Not approved' });
    expect(pendingOt.status).toBe(201);

    const run = await payroll.client.post('/payroll-runs', { frequency: 'MONTHLY', periodStart: d.start, periodEnd: d.end, payDate: d.end });
    expect(run.status).toBe(201);
    const runId = run.body.data.id;
    const prep = await payroll.client.post(`/payroll-runs/${runId}/prepare`);
    expect(prep.status).toBe(200);
    expect(prep.body.data.run.status).toBe('PREPARED');
    expect(prep.body.data.run.ruleVersionId).toBe(ruleVersionId);
    const snap = await ctx.prisma.payrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId: mid }, include: { earnings: true } });
    const calc = snap.calculation as any;
    expect(calc.ruleVersionId).toBe(ruleVersionId);
    expect(snap.hourlyEquivalent.toString()).toBe('1000'); // 173,330 / 173.33
    const otLine = snap.earnings.find((x) => x.category === 'OVERTIME')!;
    expect(otLine.amount.toFixed(2)).toBe('6000.00'); // 4h × 1000 × 1.5 (approved only)
    expect(snap.earnings.find((x) => x.category === 'LEAVE_UNPAID')).toBeTruthy();

    // separation of duties: preparer cannot review/approve
    expect((await payroll.client.post(`/payroll-runs/${runId}/review`, {})).status).toBe(403);
    expect((await finance.client.post(`/payroll-runs/${runId}/review`, {})).status).toBe(200);
    expect((await finance.client.post(`/payroll-runs/${runId}/approve`, {})).status).toBe(200);
    const approved = await ctx.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect(approved.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    // AC-09: API edits are rejected and the database refuses direct modification
    expect((await payroll.client.post(`/payroll-runs/${runId}/prepare`)).status).toBe(409);
    expect((await payroll.client.post(`/payroll-runs/${runId}/adjustments`, { employeeId: mid, kind: 'BONUS', description: 'Late bonus', amount: '100' })).status).toBe(409);
    expect((await payroll.client.delete(`/payroll-runs/${runId}`)).status).toBe(409);
    await expect(ctx.prisma.payrollRunEmployee.update({ where: { id: snap.id }, data: { netPay: new Prisma.Decimal(1) } })).rejects.toThrow(/PAYROLL_LOCKED/);
    await expect(ctx.prisma.payrollRun.update({ where: { id: runId }, data: { netTotal: new Prisma.Decimal(1) } })).rejects.toThrow(/PAYROLL_LOCKED/);
    expect((await finance.client.post(`/payroll-runs/${runId}/lock`)).status).toBe(200);
    await expect(ctx.prisma.payrollRun.update({ where: { id: runId }, data: { notes: 'tamper' } })).rejects.toThrow(/PAYROLL_LOCKED/);
    // period lock blocks new timesheets/leave/overtime in the closed period
    const late = await payroll.client.post('/overtime', { employeeId: mid, workDate: d.monday, hours: '1', overtimeRuleId: otRule.body.data.id, reason: 'Late entry' });
    expect(late.status).toBe(422);
    expect(late.body.error.message).toMatch(/locked/);
    const closedLeave = await t.admin.post('/leave/requests', { employeeId: mid, leaveTypeId: unpaid.id, startDate: d.end, endDate: d.end });
    expect([422]).toContain(closedLeave.status);
    // consumed inputs are linked to the run; pending overtime is not
    expect((await ctx.prisma.overtimeRequest.findUniqueOrThrow({ where: { id: ot.body.data.id } })).payrollRunId).toBe(runId);
    expect((await ctx.prisma.overtimeRequest.findUniqueOrThrow({ where: { id: pendingOt.body.data.id } })).payrollRunId).toBeNull();

    // AC-10: Manager with payslips.print.any prints an approved payslip; the event is audited
    await ctx.jobs.runPending();
    const mgr = await addMember(ctx, t.tenantId, ['MANAGER']);
    const slips = await mgr.client.get(`/payslips?employeeId=${mid}`);
    expect(slips.status).toBe(200);
    const slipId = slips.body.data[0].id;
    const pdf = await mgr.client.get(`/payslips/${slipId}/download?inline=true`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await mgr.client.post(`/payslips/${slipId}/print-event`)).status).toBe(200);
    const events = await ctx.prisma.payslipAccessEvent.findMany({ where: { payslipId: slipId } });
    expect(events.map((e) => e.action).sort()).toEqual(['PRINT', 'VIEW']);
    expect(events.every((e) => e.userId === mgr.userId && e.employeeId === mid && e.tenantId === t.tenantId)).toBe(true);
    // an employee without print-any cannot see someone else's payslip
    const other = await t.admin.post('/employees', employeeBody());
    const { client: emp } = await addMember(ctx, t.tenantId, ['EMPLOYEE'], other.body.data.id);
    expect((await emp.get(`/payslips/${slipId}/download`)).status).toBe(404);

    // bank file requires a bank account; reports reflect the locked run
    const bank = await payroll.client.post(`/payroll-runs/${runId}/bank-file?format=csv`);
    expect(bank.status).toBe(200);
    expect(bank.headers['x-missing-bank-accounts']).toBe('1');
    const register = await finance.client.get(`/reports/payroll-register?runId=${runId}`);
    expect(register.status).toBe(200);
    expect(register.body.data.rows).toHaveLength(1);

    // Corrections: reversal run with negated snapshot, its own lifecycle, then the period re-opens
    const rev = await finance.client.post(`/payroll-runs/${runId}/reverse`, { reason: 'Incorrect salary rate' });
    expect(rev.status).toBe(200);
    expect(rev.body.data.runType).toBe('REVERSAL');
    expect(Number(rev.body.data.netTotal)).toBe(-Number(approved.netTotal));
    expect((await payroll.client.post(`/payroll-runs`, { frequency: 'MONTHLY', periodStart: d.start, periodEnd: d.end, payDate: d.end })).status).toBe(422);
    await t.admin.post(`/payroll-runs/${rev.body.data.id}/review`, {});
    expect((await t.admin.post(`/payroll-runs/${rev.body.data.id}/approve`, {})).status).toBe(200);
    expect((await t.admin.post(`/payroll-runs/${rev.body.data.id}/lock`)).status).toBe(200);
    const original = await ctx.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect(original.status).toBe('LOCKED');
    expect((await ctx.prisma.overtimeRequest.findUniqueOrThrow({ where: { id: ot.body.data.id } })).payrollRunId).toBeNull();
    const rerun = await payroll.client.post(`/payroll-runs`, { frequency: 'MONTHLY', periodStart: d.start, periodEnd: d.end, payDate: d.end });
    expect(rerun.status).toBe(201);
    expect(rerun.body.data.revision).toBe(2);
  });

  it('payroll refuses to calculate without an approved statutory rule version', async () => {
    const t = await registerTenant(ctx);
    await upgradeTenant(ctx, t.tenantId);
    await t.admin.post('/employees', employeeBody());
    const d = lastMonth();
    const run = await t.admin.post('/payroll-runs', { frequency: 'MONTHLY', periodStart: d.start, periodEnd: d.end, payDate: d.end });
    const prep = await t.admin.post(`/payroll-runs/${run.body.data.id}/prepare`);
    expect(prep.status).toBe(422);
    expect(prep.body.error.details.reason).toBe('NO_APPROVED_STATUTORY_RULES');
    // the seeded draft has zero rates and cannot be approved as-is
    const versions = await t.admin.get('/payroll/statutory-versions');
    const draft = versions.body.data[0];
    expect(draft.status).toBe('DRAFT');
    const finance = await addMember(ctx, t.tenantId, ['FINANCE_APPROVER']);
    expect((await finance.client.post(`/payroll/statutory-versions/${draft.id}/approve`, { attestation: 'Attempting to approve zero-rate template.' })).status).toBe(422);
  });

  it('weekly hourly payroll pays only approved timesheet hours', async () => {
    const t = await registerTenant(ctx);
    await upgradeTenant(ctx, t.tenantId);
    const payroll = await addMember(ctx, t.tenantId, ['PAYROLL_OFFICER']);
    const finance = await addMember(ctx, t.tenantId, ['FINANCE_APPROVER']);
    await approvedSyntheticRules(ctx, payroll.client, finance.client);
    const e = await t.admin.post('/employees', employeeBody({ payFrequency: 'WEEKLY', payType: 'HOURLY', hourlyRate: '1000.00', salaryPerPeriod: null }));
    const d = lastMonth();
    const a = await payroll.client.post('/timesheets', { employeeId: e.body.data.id, workDate: d.monday, startTime: '08:00', endTime: '16:00' });
    await payroll.client.post('/timesheets', { employeeId: e.body.data.id, workDate: d.tuesday, startTime: '08:00', endTime: '12:00' });
    await t.admin.post(`/timesheets/${a.body.data.id}/approve`, {});
    const run = await payroll.client.post('/payroll-runs', { frequency: 'WEEKLY', periodStart: d.monday, periodEnd: d.sunday, payDate: d.sunday });
    const prep = await payroll.client.post(`/payroll-runs/${run.body.data.id}/prepare`);
    expect(prep.status).toBe(200);
    const snap = await ctx.prisma.payrollRunEmployee.findFirstOrThrow({ where: { runId: run.body.data.id } });
    expect(snap.regularHours.toString()).toBe('8');
    expect(snap.grossPay.toFixed(2)).toBe('8000.00');
  });
});
