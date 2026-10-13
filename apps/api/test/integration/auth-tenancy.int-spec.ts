import ExcelJS from 'exceljs';
import { Client, PASSWORD, TestContext, addMember, bootstrap, createPlatformStaff, employeeBody, registerTenant } from './helpers';

describe('Identity, tenancy and security', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await bootstrap();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('AC-01: registration creates exactly one centrally-registered Free subscription with no payment or code', async () => {
    const { admin, tenantId } = await registerTenant(ctx);
    const subs = await ctx.prisma.subscription.findMany({ where: { tenantId } });
    expect(subs).toHaveLength(1);
    expect(subs[0].status).toBe('FREE');
    expect(subs[0].source).toBe('FREE_SIGNUP');
    expect(await ctx.prisma.manualPayment.count({ where: { tenantId } })).toBe(0);
    expect(await ctx.prisma.activationCode.count({ where: { subscriptionId: subs[0].id } })).toBe(0);
    const me = await admin.get('/auth/me');
    expect(me.body.data.entitlements).toMatchObject({ planCode: 'FREE', employeeLimit: 5, userLimit: 2, status: 'FREE' });
    expect(me.body.data.entitlements.features).not.toContain('PAYROLL');
    // second Free subscription is refused
    const again = await admin.post('/subscription/start-free');
    expect(again.status).toBe(409);
  });

  it('rejects login before email verification and does not enumerate accounts', async () => {
    const anon = new Client(ctx);
    await anon.post('/auth/register', { companyLegalName: 'Unverified Ltd', companyDisplayName: 'Unverified', fullName: 'Un Verified', email: 'unverified@example.test', password: PASSWORD, acceptTerms: true });
    const res = await anon.agent.post('/api/v1/auth/login').send({ email: 'unverified@example.test', password: PASSWORD });
    expect(res.status).toBe(403);
    const bad = await anon.agent.post('/api/v1/auth/login').send({ email: 'nobody@example.test', password: PASSWORD });
    expect(bad.status).toBe(401);
    const dup = await anon.post('/auth/register', { companyLegalName: 'Dup Ltd', companyDisplayName: 'Dup', fullName: 'Dup User', email: 'unverified@example.test', password: PASSWORD, acceptTerms: true });
    expect(dup.status).toBe(201); // identical response for existing accounts
  });

  it('requires a session-bound CSRF token on authenticated writes', async () => {
    const { admin } = await registerTenant(ctx);
    const noToken = await admin.agent.post('/api/v1/employees').send(employeeBody());
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');
    const badOrigin = await admin.agent.post('/api/v1/employees').set('X-CSRF-Token', admin.csrf).set('Origin', 'https://evil.example').send(employeeBody());
    expect(badOrigin.status).toBe(403);
    const ok = await admin.post('/employees', employeeBody());
    expect(ok.status).toBe(201);
  });

  it('SEC-006: privileged tenant roles must complete MFA before using the API', async () => {
    const { tenantId } = await registerTenant(ctx);
    const email = `mfa-${Date.now()}@example.test`;
    const pw = await import('../../src/auth/password.service');
    const hash = await ctx.app.get(pw.PasswordService).hash(PASSWORD);
    const user = await ctx.prisma.user.create({ data: { email, fullName: 'Payroll Person', passwordHash: hash, emailVerifiedAt: new Date() } });
    const role = await ctx.prisma.role.findFirstOrThrow({ where: { tenantId, code: 'PAYROLL_OFFICER' } });
    await ctx.prisma.tenantMembership.create({ data: { tenantId, userId: user.id, roles: { create: [{ roleId: role.id }] } } });
    const c = new Client(ctx);
    await c.login(email);
    const blocked = await c.get('/employees');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MFA_SETUP_REQUIRED');
    await c.completeMfa();
    expect((await c.get('/employees')).status).toBe(200);
  });

  it('enforces RBAC server-side and redacts sensitive fields', async () => {
    const { admin, tenantId } = await registerTenant(ctx);
    const created = await admin.post('/employees', employeeBody({ trn: '123456789' }));
    expect(created.status).toBe(201);
    expect(created.body.data.trn).toBe('•••• 6789');
    const revealed = await admin.get(`/employees/${created.body.data.id}?reveal=true`);
    expect(revealed.body.data.trn).toBe('123456789');
    const audit = await ctx.prisma.auditEvent.findFirst({ where: { tenantId, action: 'employee.identifiers_viewed' } });
    expect(audit).toBeTruthy();
    const { client: emp } = await addMember(ctx, tenantId, ['EMPLOYEE'], created.body.data.id);
    expect((await emp.get('/employees')).status).toBe(403);
    expect((await emp.post('/employees', employeeBody())).status).toBe(403);
    const own = await emp.get(`/employees/${created.body.data.id}`);
    expect(own.status).toBe(200);
    expect(own.body.data.salaryPerPeriod).toBe('200000.00'); // own compensation visible
    const { client: hr } = await addMember(ctx, tenantId, ['HR_OFFICER']);
    const hrView = await hr.get(`/employees/${created.body.data.id}`);
    expect(hrView.body.data.salaryPerPeriod).toBeNull(); // HR officer lacks compensation.read
  });

  it('AC-12: a user can never read or modify another tenant’s records by changing IDs', async () => {
    const a = await registerTenant(ctx);
    const b = await registerTenant(ctx);
    const empA = await a.admin.post('/employees', employeeBody());
    const idA = empA.body.data.id;
    expect((await b.admin.get(`/employees/${idA}`)).status).toBe(404);
    expect((await b.admin.patch(`/employees/${idA}`, { firstName: 'Hacked', version: 0 })).status).toBe(404);
    expect((await b.admin.post(`/employees/${idA}/deactivate`, { reason: 'cross tenant' })).status).toBe(404);
    const listB = await b.admin.get('/employees?pageSize=200');
    expect(listB.body.data.find((e: any) => e.id === idA)).toBeUndefined();
    // Tenant id in the body/query is ignored; switching to a tenant without membership is refused
    expect((await b.admin.post('/auth/switch-tenant', { tenantId: a.tenantId })).status).toBe(403);
    const leave = await b.admin.post('/leave/requests', { employeeId: idA, leaveTypeId: 'x', startDate: '2026-08-03', endDate: '2026-08-03' });
    expect([400, 404]).toContain(leave.status);
    const unchanged = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: idA } });
    expect(unchanged.firstName).toBe('Test');
  });

  it('platform sessions are distinct: tenant admins cannot reach the Qwik portal', async () => {
    const { admin, email } = await registerTenant(ctx);
    expect((await admin.get('/platform/dashboard')).status).toBe(401);
    const p = new Client(ctx, 'PLATFORM');
    const res = await p.agent.post('/api/v1/platform/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('AC-15: company name changes propagate to session branding and exports', async () => {
    const { admin } = await registerTenant(ctx);
    await admin.post('/employees', employeeBody());
    const upd = await admin.patch('/tenants/current', { legalName: 'Renamed Holdings Limited', displayName: 'Renamed Holdings' });
    expect(upd.status).toBe(200);
    const me = await admin.get('/auth/me');
    expect(me.body.data.activeTenant.displayName).toBe('Renamed Holdings');
    const xlsx = await admin.get('/reports/employee-roster?format=xlsx').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    expect(wb.worksheets[0].getCell('A1').value).toBe('Renamed Holdings');
  });

  it('locks accounts after repeated failed logins', async () => {
    const { email } = await registerTenant(ctx);
    const c = new Client(ctx);
    for (let i = 0; i < 5; i++) await c.agent.post('/api/v1/auth/login').send({ email, password: 'wrong-password-123' });
    const res = await c.agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(429);
  });
  it('MFA reset: tenant admin for single-organisation users, Qwik super admin for anyone; sessions revoked and audited', async () => {
    const { admin, tenantId } = await registerTenant(ctx);
    const member = await addMember(ctx, tenantId, ['PAYROLL_OFFICER']);
    const users = (await admin.get('/users')).body.data as { id: string; user: { email: string } }[];
    const target = users.find((u) => u.user.email === member.email)!;
    const self = users.find((u) => u.user.email !== member.email)!;

    expect((await admin.post(`/users/${self.id}/reset-mfa`, { reason: 'Lost phone, identity verified by call' })).status).toBe(422);
    expect((await admin.post(`/users/${target.id}/reset-mfa`, { reason: 'short' })).status).toBe(400);
    const ok = await admin.post(`/users/${target.id}/reset-mfa`, { reason: 'Lost phone; identity verified in person by HR' });
    expect(ok.status).toBe(200);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: member.userId } })).mfaEnabledAt).toBeNull();
    expect((await member.client.get('/auth/me')).status).toBe(401); // all sessions revoked
    expect(ctx.mail.outbox.some((m) => m.to === member.email && m.template === 'mfa_reset')).toBe(true);
    const audit = await ctx.prisma.auditEvent.findFirst({ where: { tenantId, action: 'user.mfa_reset', entityId: member.userId } });
    expect(audit?.reason).toMatch(/identity verified/);
    // At the next sign-in the privileged user must enrol MFA again
    const again = new Client(ctx);
    await again.login(member.email);
    expect((await again.get('/employees')).status).toBe(403);
    await again.completeMfa();
    await again.refreshCsrf();
    expect((await again.get('/employees')).status).toBe(200);

    // A user who also belongs to another organisation can only be reset by Qwik
    const other = await registerTenant(ctx);
    const role = await ctx.prisma.role.findFirstOrThrow({ where: { tenantId: other.tenantId, code: 'HR_OFFICER' } });
    await ctx.prisma.tenantMembership.create({ data: { tenantId: other.tenantId, userId: member.userId, status: 'ACTIVE', roles: { create: [{ roleId: role.id }] } } });
    const refused = await admin.post(`/users/${target.id}/reset-mfa`, { reason: 'Lost phone; identity verified in person by HR' });
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toMatch(/another organization/);

    const officer = await createPlatformStaff(ctx, 'PLATFORM_LICENSING_OFFICER');
    await officer.client.refreshCsrf();
    expect((await officer.client.post('/platform/accounts/reset-mfa', { email: member.email, reason: 'Identity verified by video call' })).status).toBe(403);
    const sup = await createPlatformStaff(ctx, 'PLATFORM_SUPER_ADMIN');
    await sup.client.refreshCsrf();
    const platformReset = await sup.client.post('/platform/accounts/reset-mfa', { email: member.email, reason: 'Identity verified by video call with ID' });
    expect(platformReset.status).toBe(200);
    expect(await ctx.prisma.auditEvent.count({ where: { action: 'platform.account_mfa_reset', entityId: member.userId } })).toBe(1);
  });
});
