import JSZip from 'jszip';
import { Prisma } from '@prisma/client';
import { DataExportService } from '../../src/retention/data-export.service';
import { RetentionService } from '../../src/retention/retention.service';
import { TestContext, bootstrap, createPlatformStaff, employeeBody, registerTenant, upgradeTenant } from './helpers';

/** Creates an approved+locked historical payroll run directly (as the migration tool does). */
async function oldLockedRun(ctx: TestContext, tenantId: string, employeeId: string, userId: string, payDate: string) {
  const period = await ctx.prisma.payrollPeriod.create({ data: { tenantId, frequency: 'MONTHLY', periodStart: new Date(`${payDate.slice(0, 8)}01T00:00:00Z`), periodEnd: new Date(`${payDate}T00:00:00Z`), payDate: new Date(`${payDate}T00:00:00Z`), status: 'CLOSED' } });
  const run = await ctx.prisma.payrollRun.create({ data: { tenantId, periodId: period.id, runNumber: `OLD-${payDate}`, frequency: 'MONTHLY', runType: 'REGULAR', createdById: userId } });
  const emp = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const D = Prisma.Decimal;
  const line = await ctx.prisma.payrollRunEmployee.create({
    data: { tenantId, runId: run.id, employeeId, employeeNumber: emp.employeeNumber, employeeName: 'X', payFrequency: 'MONTHLY', payType: 'SALARY', grossPay: new D(100), taxableGross: new D(100), totalDeductions: new D(10), employerContributions: new D(0), netPay: new D(90), calculation: {}, inputs: {}, deductions: { create: [{ tenantId, code: 'TAX', description: 'Tax', category: 'STATUTORY', statutory: true, employeeAmount: new D(10) }] } },
  });
  await ctx.prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() } });
  await ctx.prisma.payslip.create({ data: { tenantId, runId: run.id, runEmployeeId: line.id, employeeId, payDate: period.payDate } });
  await ctx.prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'LOCKED', lockedById: userId, lockedAt: new Date() } });
  return run.id;
}

describe('Data lifecycle (NFR-011)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await bootstrap();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('retention policy cannot go below legal minimums', async () => {
    const t = await registerTenant(ctx);
    const r = await t.admin.get('/data/retention');
    expect(r.body.data.policy).toMatchObject({ payrollRecords: 7, employeeRecords: 7, importFiles: 90 });
    expect((await t.admin.put('/data/retention', { payrollRecords: 5 })).status).toBe(400);
    const ok = await t.admin.put('/data/retention', { payrollRecords: 10, importFiles: 30 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.policy).toMatchObject({ payrollRecords: 10, importFiles: 30 });
  });

  it('full data export bundle contains every record type, decrypted identifiers, and is audited on download', async () => {
    const t = await registerTenant(ctx);
    await t.admin.post('/employees', employeeBody({ firstName: 'Export', trn: '123456789' }));
    const req = await t.admin.post('/data/exports');
    expect(req.status).toBe(201);
    await ctx.app.get(DataExportService).build(req.body.data.id);
    const list = await t.admin.get('/data/exports');
    expect(list.body.data[0]).toMatchObject({ status: 'READY' });
    const dl = await t.admin.agent.get(`/api/v1/data/exports/${req.body.data.id}/download`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    const zip = await JSZip.loadAsync(dl.body as Buffer);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.counts.employees).toBe(1);
    expect(await zip.file('data/employees.csv')!.async('string')).toContain('123456789');
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['README.txt', 'data/payroll_runs.csv', 'data/audit_log.csv', 'data/leave_ledger.csv']));
    expect(await ctx.prisma.auditEvent.count({ where: { tenantId: t.tenantId, action: 'data.export_downloaded' } })).toBe(1);
  });

  it('daily retention purges only what has expired; statutory records need the purge path; legal hold stops everything', async () => {
    const t = await registerTenant(ctx);
    await upgradeTenant(ctx, t.tenantId);
    const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: t.email } });
    const leaver = await t.admin.post('/employees', employeeBody({ firstName: 'Long', lastName: 'Gone', hireDate: '2010-01-01', trn: '111222333' }));
    const leaverId = leaver.body.data.id;
    await ctx.prisma.employee.update({ where: { id: leaverId }, data: { status: 'TERMINATED', terminationDate: new Date('2015-06-30T00:00:00Z') } });
    const current = await t.admin.post('/employees', employeeBody({ firstName: 'Still', lastName: 'Here' }));
    const oldRun = await oldLockedRun(ctx, t.tenantId, leaverId, admin.id, '2015-05-31');
    const recentRun = await oldLockedRun(ctx, t.tenantId, current.body.data.id, admin.id, '2024-05-31');

    // Outside the purge path the database still refuses
    await expect(ctx.prisma.payrollRun.delete({ where: { id: oldRun } })).rejects.toThrow(/PAYROLL_LOCKED/);

    const retention = ctx.app.get(RetentionService);
    await ctx.prisma.tenant.update({ where: { id: t.tenantId }, data: { legalHold: true, legalHoldReason: 'Pending litigation' } });
    expect(await retention.runForTenant(t.tenantId)).toEqual({ legalHoldSkipped: 1 });
    expect(await ctx.prisma.payrollRun.count({ where: { id: oldRun } })).toBe(1);
    await ctx.prisma.tenant.update({ where: { id: t.tenantId }, data: { legalHold: false, legalHoldReason: null } });

    const s = await retention.runForTenant(t.tenantId);
    expect(s).toMatchObject({ payrollRuns: 1, employeesAnonymised: 1 });
    expect(await ctx.prisma.payrollRun.count({ where: { id: oldRun } })).toBe(0);
    expect(await ctx.prisma.payrollRun.count({ where: { id: recentRun } })).toBe(1); // within 7 years
    const anon = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: leaverId } });
    expect(anon).toMatchObject({ firstName: 'Former', trnEnc: null, dateOfBirth: null });
    expect(anon.anonymisedAt).not.toBeNull();
    // and the flag does not leak: a later delete is refused again
    await expect(ctx.prisma.payrollRun.delete({ where: { id: recentRun } })).rejects.toThrow(/PAYROLL_LOCKED/);
  });

  it('account closure: typed confirmation, cooling-off, Qwik approval, then close and final purge', async () => {
    const t = await registerTenant(ctx);
    await t.admin.post('/employees', employeeBody({ firstName: 'Closing' }));
    expect((await t.admin.post('/data/deletion-requests', { reason: 'We are winding up the company', confirmName: 'wrong name' })).status).toBe(400);
    const req = await t.admin.post('/data/deletion-requests', { reason: 'We are winding up the company', confirmName: t.name });
    expect(req.status).toBe(201);
    expect(req.body.data.status).toBe('PENDING');
    expect((await t.admin.post('/data/deletion-requests', { reason: 'Second attempt here', confirmName: t.name })).status).toBe(422);

    const officer = await createPlatformStaff(ctx, 'PLATFORM_LICENSING_OFFICER');
    await officer.client.refreshCsrf();
    expect((await officer.client.post(`/platform/deletion-requests/${req.body.data.id}/approve`, { note: 'Verified with director' })).status).toBe(403);
    const sup = await createPlatformStaff(ctx, 'PLATFORM_SUPER_ADMIN');
    await sup.client.refreshCsrf();
    expect((await sup.client.post(`/platform/deletion-requests/${req.body.data.id}/approve`, { note: 'Verified with director by phone' })).status).toBe(200);

    const retention = ctx.app.get(RetentionService);
    expect(await retention.executeDueDeletions()).toEqual({ deletionsExecuted: 0 }); // still cooling off
    await ctx.prisma.deletionRequest.update({ where: { id: req.body.data.id }, data: { coolingOffUntil: new Date(Date.now() - 1000) } });
    expect(await retention.executeDueDeletions()).toEqual({ deletionsExecuted: 1 });
    const closed = await ctx.prisma.tenant.findUniqueOrThrow({ where: { id: t.tenantId } });
    expect(closed.status).toBe('CLOSED');
    expect((await t.admin.get('/employees')).status).toBe(401); // sessions revoked

    await ctx.prisma.tenant.update({ where: { id: t.tenantId }, data: { purgeAfter: new Date(Date.now() - 1000) } });
    const purged = await retention.runForTenant(t.tenantId);
    expect(purged.tenantsPurged).toBe(1);
    expect(await ctx.prisma.employee.count({ where: { tenantId: t.tenantId } })).toBe(0);
    expect(await ctx.prisma.auditEvent.count({ where: { tenantId: t.tenantId } })).toBe(0);
    expect((await ctx.prisma.tenant.findUniqueOrThrow({ where: { id: t.tenantId } })).displayName).toBe('Closed organisation');
    expect(await ctx.prisma.subscription.count({ where: { tenantId: t.tenantId } })).toBeGreaterThan(0); // Qwik's commercial records stay
  });
});
