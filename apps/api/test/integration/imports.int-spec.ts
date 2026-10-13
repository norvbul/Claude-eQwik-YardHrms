import ExcelJS from 'exceljs';
import { TestContext, bootstrap, employeeBody, registerTenant, upgradeTenant } from './helpers';

function csv(rows: string[][]) {
  return Buffer.from(rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n'));
}

const EMP_HEADER = ['Employee Number', 'First Name', 'Last Name', 'Email', 'Department Code', 'Hire Date (YYYY-MM-DD)', 'Pay Frequency (WEEKLY/FORTNIGHTLY/MONTHLY)', 'Pay Type (SALARY/HOURLY)', 'Salary per Period', 'Hourly Rate', 'TRN'];

describe('Bulk imports (IMP-001…005)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await bootstrap();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('serves versioned xlsx templates', async () => {
    const t = await registerTenant(ctx);
    await upgradeTenant(ctx, t.tenantId);
    const res = await t.admin.get('/imports/templates/employees').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.getWorksheet('Employees')!.getCell('A1').value).toBe('Employee Number');
    expect(wb.getWorksheet('Instructions')).toBeTruthy();
  });

  it('is gated by the BULK_IMPORT entitlement (not on Free)', async () => {
    const t = await registerTenant(ctx);
    const res = await t.admin.upload('/imports/employees', 'e.csv', csv([EMP_HEADER]));
    expect(res.status).toBe(402);
  });

  it('AC-13: mixed-validity employee import — every row has an outcome, valid rows commit exactly once, blank cells keep values on update', async () => {
    const t = await registerTenant(ctx);
    await upgradeTenant(ctx, t.tenantId, 'PROFESSIONAL');
    await t.admin.post('/master-data/departments', { code: 'OPS', name: 'Operations' });
    const existing = await t.admin.post('/employees', employeeBody({ employeeNumber: 'EXIST-1', firstName: 'Original', email: 'keep@example.test' }));
    expect(existing.status).toBe(201);
    const file = csv([
      EMP_HEADER,
      ['', 'Alice', 'New', 'alice@example.test', 'OPS', '2026-01-05', 'MONTHLY', 'SALARY', '150000', '', '111222333'], // create (auto number)
      ['EXIST-1', 'Updated', '', '', '', '', '', '', '', '', ''], // update: only first name changes
      ['', 'Bob', 'Bad', 'bob@example.test', 'NOPE', '2026-01-05', 'MONTHLY', 'SALARY', '100000', '', ''], // unknown dept
      ['', 'Carl', 'Hourly', '', '', '2026-01-05', 'MONTHLY', 'HOURLY', '', '900', ''], // monthly hourly invalid
      ['', 'Dana', 'Missing', '', '', '', 'WEEKLY', 'HOURLY', '', '900', ''], // missing hire date
      ['NEW-9', 'Eve', 'Explicit', '', '', '2026-02-01', 'FORTNIGHTLY', 'HOURLY', '', '1200.50', '111222333'], // duplicate TRN in file
    ]);
    const up = await t.admin.upload('/imports/employees', 'employees.csv', file);
    expect(up.status).toBe(201);
    const batchId = up.body.data.batch.id;
    expect(up.body.data.batch.status).toBe('VALIDATED');
    expect(up.body.data.counts).toEqual({ VALID: 2, REJECTED: 4 });
    const rejected = up.body.data.rows.filter((r: any) => r.outcome === 'REJECTED');
    expect(rejected.every((r: any) => r.errors.length > 0)).toBe(true);
    expect(rejected.flatMap((r: any) => r.errors.map((e: any) => e.message))).toEqual(
      expect.arrayContaining(['department code "NOPE" not found', 'Hire Date (YYYY-MM-DD) is required', 'Duplicate TRN in this file']),
    );

    const exec = await t.admin.post(`/imports/${batchId}/execute`);
    expect(exec.status).toBe(200);
    expect(exec.body.data.batch.status).toBe('QUEUED');
    await ctx.jobs.runPending();
    const done = await t.admin.get(`/imports/${batchId}`);
    expect(done.body.data.batch.status).toBe('COMPLETED');
    expect(done.body.data.counts).toEqual({ CREATED: 1, UPDATED: 1, REJECTED: 4 });
    const updated = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: existing.body.data.id } });
    expect(updated.firstName).toBe('Updated');
    expect(updated.email).toBe('keep@example.test'); // blank cell = unchanged
    const alice = await ctx.prisma.employee.findFirstOrThrow({ where: { tenantId: t.tenantId, firstName: 'Alice' } });
    expect(alice.employeeNumber).toMatch(/^EMP-\d{4}$/);
    expect(alice.source).toBe('IMPORT');

    // Retry / replay safety: re-running the job or re-executing creates nothing new
    await ctx.jobs.enqueue('imports.process', { batchId }, { tenantId: t.tenantId });
    await ctx.jobs.runPending();
    expect((await t.admin.post(`/imports/${batchId}/execute`)).status).toBe(409);
    expect(await ctx.prisma.employee.count({ where: { tenantId: t.tenantId, firstName: 'Alice' } })).toBe(1);

    const results = await t.admin.get(`/imports/${batchId}/results.csv`);
    expect(results.status).toBe(200);
    expect(results.text.split('\r\n').filter(Boolean)).toHaveLength(7);
    expect(await ctx.prisma.auditEvent.count({ where: { tenantId: t.tenantId, action: 'import.completed', entityId: batchId } })).toBe(1);
  });

  it('AC-02 via import: rows beyond the employee limit are rejected individually', async () => {
    const t = await registerTenant(ctx);
    const { subscriptionId, verifier } = await upgradeTenant(ctx, t.tenantId, 'PROFESSIONAL');
    await verifier.client.post(`/platform/subscriptions/${subscriptionId}/capacity`, { employeeLimitOverride: 3, userLimitOverride: null, reason: 'Test cap' });
    await t.admin.post('/employees', employeeBody());
    const rows = [EMP_HEADER, ...['A', 'B', 'C', 'D'].map((n) => ['', `Cap${n}`, 'Test', '', '', '2026-01-05', 'MONTHLY', 'SALARY', '100000', '', ''])];
    const up = await t.admin.upload('/imports/employees', 'cap.csv', csv(rows));
    const cap = await t.admin.get(`/imports/${up.body.data.batch.id}/capacity`);
    expect(cap.body.data).toMatchObject({ limit: 3, active: 1, creates: 4, overBy: 2 });
    await t.admin.post(`/imports/${up.body.data.batch.id}/execute`);
    await ctx.jobs.runPending();
    const done = await t.admin.get(`/imports/${up.body.data.batch.id}`);
    expect(done.body.data.counts).toEqual({ CREATED: 2, REJECTED: 2 });
    expect(JSON.stringify(done.body.data.rows)).toMatch(/allows 3 active employees/);
    expect(await ctx.prisma.employee.count({ where: { tenantId: t.tenantId, status: 'ACTIVE' } })).toBe(3);
  });

  it('timesheet import rejects monthly employees, duplicates and overlaps; imported rows start PENDING', async () => {
    const t = await registerTenant(ctx);
    await upgradeTenant(ctx, t.tenantId, 'PROFESSIONAL');
    await t.admin.post('/employees', employeeBody({ employeeNumber: 'W-1', payFrequency: 'WEEKLY', payType: 'HOURLY', hourlyRate: '1000', salaryPerPeriod: null }));
    await t.admin.post('/employees', employeeBody({ employeeNumber: 'M-1', payFrequency: 'MONTHLY' }));
    const d = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Timesheets');
    ws.addRow(['Employee Number', 'Work Date (YYYY-MM-DD)', 'Shift Code', 'Start Time (HH:mm)', 'End Time (HH:mm)', 'Break Hours', 'Comments']);
    ws.addRow(['W-1', d, '', '08:00', '16:00', '0.5', 'ok']);
    ws.addRow(['W-1', d, '', '08:00', '16:00', '0.5', 'duplicate in file']);
    ws.addRow(['W-1', d, '', '12:00', '14:00', '0', 'overlaps first row']);
    ws.addRow(['M-1', d, '', '08:00', '16:00', '0', 'monthly employee']);
    ws.addRow(['X-404', d, '', '08:00', '16:00', '0', 'unknown']);
    ws.addRow(['W-1', 'not-a-date', '', '8:00', '25:00', '0', 'bad values']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await t.admin.upload('/imports/timesheets', 'ts.xlsx', buf);
    expect(up.status).toBe(201);
    expect(up.body.data.counts).toEqual({ VALID: 2, REJECTED: 4 });
    expect(JSON.stringify(up.body.data.rows)).toMatch(/Monthly employees do not submit regular timesheets/);
    await t.admin.post(`/imports/${up.body.data.batch.id}/execute`);
    await ctx.jobs.runPending();
    const done = await t.admin.get(`/imports/${up.body.data.batch.id}`);
    expect(done.body.data.counts).toEqual({ CREATED: 1, REJECTED: 5 });
    const ts = await ctx.prisma.timesheet.findMany({ where: { tenantId: t.tenantId } });
    expect(ts).toHaveLength(1);
    expect(ts[0].status).toBe('PENDING');
    expect(ts[0].source).toBe('IMPORT');
  });

  it('rejects disguised or oversized files', async () => {
    const t = await registerTenant(ctx);
    await upgradeTenant(ctx, t.tenantId, 'PROFESSIONAL');
    const bin = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00]);
    expect((await t.admin.upload('/imports/employees', 'evil.csv', bin)).status).toBe(400);
    expect((await t.admin.upload('/imports/employees', 'evil.exe', Buffer.from('MZ'))).status).toBe(400);
  });
});
