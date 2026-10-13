import { Client, TestContext, addMember, bootstrap, createPlatformStaff, employeeBody, registerTenant, uniq, upgradeTenant } from './helpers';

describe('Subscriptions, licensing and entitlements', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await bootstrap();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  async function verifiedPayment(customerId: string, planCode = 'STARTER') {
    const recorder = await createPlatformStaff(ctx, 'PLATFORM_LICENSING_OFFICER');
    const verifier = await createPlatformStaff(ctx);
    const plan = await ctx.prisma.plan.findUniqueOrThrow({ where: { code: planCode } });
    const pay = await recorder.client.post('/platform/payments', { customerId, planId: plan.id, reference: uniq('R'), paymentDate: '2026-02-01', amount: '500.00', currency: 'JMD', method: 'CASH' });
    expect(pay.status).toBe(201);
    return { paymentId: pay.body.data.id as string, plan, recorder, verifier };
  }

  it('AC-02: a Free tenant at 5 active employees cannot add a sixth, and existing data is preserved', async () => {
    const { admin, tenantId } = await registerTenant(ctx);
    for (let i = 0; i < 5; i++) expect((await admin.post('/employees', employeeBody())).status).toBe(201);
    const sixth = await admin.post('/employees', employeeBody());
    expect(sixth.status).toBe(402);
    expect(sixth.body.error.code).toBe('CAPACITY_EXCEEDED');
    expect(await ctx.prisma.employee.count({ where: { tenantId } })).toBe(5);
    // deactivating frees capacity; reactivation is again capacity-checked (EMP-004)
    const list = await admin.get('/employees');
    const first = list.body.data[0].id;
    expect((await admin.post(`/employees/${first}/deactivate`, { reason: 'Left company' })).status).toBe(200);
    expect((await admin.post('/employees', employeeBody())).status).toBe(201);
    const react = await admin.post(`/employees/${first}/reactivate`, { reason: 'Returned' });
    expect(react.status).toBe(402);
  });

  it('enforces capacity under concurrent creation (row-locked counting)', async () => {
    const { admin, tenantId } = await registerTenant(ctx);
    for (let i = 0; i < 3; i++) await admin.post('/employees', employeeBody());
    const results = await Promise.all(Array.from({ length: 6 }, () => admin.post('/employees', employeeBody())));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await ctx.prisma.employee.count({ where: { tenantId, status: 'ACTIVE' } })).toBe(5);
  });

  it('LIC-011: user seats are enforced on invitations', async () => {
    const { admin } = await registerTenant(ctx);
    const one = await admin.post('/users/invite', { email: `${uniq('i')}@example.test`, fullName: 'Invitee One', roleCodes: ['EMPLOYEE'] });
    expect(one.status).toBe(201);
    const two = await admin.post('/users/invite', { email: `${uniq('i')}@example.test`, fullName: 'Invitee Two', roleCodes: ['EMPLOYEE'] });
    expect(two.status).toBe(402);
  });

  it('features gate routes independently of RBAC (Free has no payroll)', async () => {
    const { admin } = await registerTenant(ctx);
    const res = await admin.post('/payroll-runs', { frequency: 'MONTHLY', periodStart: '2026-01-01', periodEnd: '2026-01-31', payDate: '2026-01-31' });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('FEATURE_NOT_ENTITLED');
  });

  it('AC-03: a paid subscription needs a VERIFIED payment (separation of duties on verification)', async () => {
    const { tenantId } = await registerTenant(ctx);
    const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { tenantId } });
    const { paymentId, plan, recorder, verifier } = await verifiedPayment(customer.id);
    const early = await verifier.client.post('/platform/subscriptions', { customerId: customer.id, planId: plan.id, paymentId });
    expect(early.status).toBe(422);
    const selfVerify = await recorder.client.post(`/platform/payments/${paymentId}/verify`, {});
    expect(selfVerify.status).toBe(403);
    expect((await verifier.client.post(`/platform/payments/${paymentId}/verify`, {})).status).toBe(200);
    const sub = await verifier.client.post('/platform/subscriptions', { customerId: customer.id, planId: plan.id, paymentId });
    expect(sub.status).toBe(201);
    expect(sub.body.data.status).toBe('PENDING_ACTIVATION');
    // payment cannot fund a second subscription (double-spend)
    const again = await verifier.client.post('/platform/subscriptions', { customerId: customer.id, planId: plan.id, paymentId });
    expect(again.status).toBe(409);
    // override without permission is refused for a licensing officer
    const override = await recorder.client.post('/platform/subscriptions', { customerId: customer.id, planId: plan.id, override: true, overrideReason: 'Goodwill pilot for partner' });
    expect(override.status).toBe(403);
    const history = await ctx.prisma.manualPaymentEvent.findMany({ where: { paymentId } });
    expect(history.map((h) => h.toStatus)).toEqual(['PENDING', 'VERIFIED']);
  });

  it('AC-04/AC-05: a code redeems exactly once, for one tenant only; concurrent redemption cannot double-activate', async () => {
    const a = await registerTenant(ctx);
    const b = await registerTenant(ctx);
    const customer = await ctx.prisma.customer.create({ data: { name: 'Prospect without tenant' } });
    const { paymentId, plan, verifier } = await verifiedPayment(customer.id, 'PROFESSIONAL');
    await verifier.client.post(`/platform/payments/${paymentId}/verify`, {});
    const sub = await verifier.client.post('/platform/subscriptions', { customerId: customer.id, planId: plan.id, paymentId });
    const code = await verifier.client.post('/platform/codes', { subscriptionId: sub.body.data.id, expiresInDays: 10 });
    expect(code.status).toBe(201);
    const raw = code.body.data.code as string;
    expect(raw).toMatch(/^QWK-[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/);
    const stored = await ctx.prisma.activationCode.findUniqueOrThrow({ where: { id: code.body.data.id } });
    expect(stored.codeHash).not.toContain(raw);
    expect(JSON.stringify(stored)).not.toContain(raw.slice(4, 20));
    // the raw code is never returned again
    const list = await verifier.client.get('/platform/codes');
    expect(JSON.stringify(list.body)).not.toContain(raw);

    const [r1, r2] = await Promise.all([a.admin.post('/subscription/redeem-code', { code: raw }), b.admin.post('/subscription/redeem-code', { code: raw })]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 422]);
    const winner = r1.status === 200 ? a : b;
    const loser = r1.status === 200 ? b : a;
    const winnerEnt = await winner.admin.get('/subscription/usage');
    expect(winnerEnt.body.data.planCode).toBe('PROFESSIONAL');
    const loserEnt = await loser.admin.get('/subscription/usage');
    expect(loserEnt.body.data.planCode).toBe('FREE');
    const redeemed = await ctx.prisma.activationCode.findUniqueOrThrow({ where: { id: code.body.data.id } });
    expect(redeemed.status).toBe('REDEEMED');
    expect(redeemed.redeemedTenantId).toBe(winner.tenantId);
    // replay by the winner is rejected too
    expect((await winner.admin.post('/subscription/redeem-code', { code: raw })).status).toBe(422);
    // the previous Free subscription is superseded, not deleted
    const subs = await ctx.prisma.subscription.findMany({ where: { tenantId: winner.tenantId } });
    expect(subs.map((s) => s.status).sort()).toEqual(['ACTIVE', 'SUPERSEDED']);
  });

  it('rejects expired and revoked codes', async () => {
    const t = await registerTenant(ctx);
    const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { tenantId: t.tenantId } });
    const { paymentId, plan, verifier } = await verifiedPayment(customer.id);
    await verifier.client.post(`/platform/payments/${paymentId}/verify`, {});
    const sub = await verifier.client.post('/platform/subscriptions', { customerId: customer.id, planId: plan.id, paymentId });
    const code = await verifier.client.post('/platform/codes', { subscriptionId: sub.body.data.id, expiresInDays: 1 });
    await ctx.prisma.activationCode.update({ where: { id: code.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await t.admin.post('/subscription/redeem-code', { code: code.body.data.code });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/expired/);
  });

  it('AC-14: renewal extends expiry using a newly verified payment, linked once, with no new code', async () => {
    const t = await registerTenant(ctx);
    const { subscriptionId, verifier, recorder } = await upgradeTenant(ctx, t.tenantId, 'STARTER');
    const before = await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { tenantId: t.tenantId } });
    const pay = await recorder.client.post('/platform/payments', { customerId: customer.id, reference: uniq('RENEW'), paymentDate: '2026-09-01', amount: '1000.00', currency: 'JMD', method: 'CHEQUE' });
    // unverified payment cannot renew
    expect((await verifier.client.post(`/platform/subscriptions/${subscriptionId}/renew`, { paymentId: pay.body.data.id })).status).toBe(422);
    await verifier.client.post(`/platform/payments/${pay.body.data.id}/verify`, {});
    const renewed = await verifier.client.post(`/platform/subscriptions/${subscriptionId}/renew`, { paymentId: pay.body.data.id });
    expect(renewed.status).toBe(200);
    const after = await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(after.periodEnd!.getTime()).toBeGreaterThan(before.periodEnd!.getTime());
    expect(await ctx.prisma.activationCode.count({ where: { subscriptionId } })).toBe(0);
    const payment = await ctx.prisma.manualPayment.findUniqueOrThrow({ where: { id: pay.body.data.id } });
    expect(payment.consumedFor).toBe('RENEWAL');
    expect(payment.subscriptionId).toBe(subscriptionId);
    expect((await verifier.client.post(`/platform/subscriptions/${subscriptionId}/renew`, { paymentId: pay.body.data.id })).status).toBe(409);
    expect(await ctx.prisma.subscriptionEvent.count({ where: { subscriptionId, type: 'RENEWED' } })).toBe(1);
  });

  it('AC-11: after expiry + grace, writes are blocked but historical reads remain', async () => {
    const t = await registerTenant(ctx);
    const { subscriptionId } = await upgradeTenant(ctx, t.tenantId, 'STARTER');
    expect((await t.admin.post('/employees', employeeBody())).status).toBe(201);
    await ctx.prisma.subscription.update({ where: { id: subscriptionId }, data: { periodEnd: new Date(Date.now() - 10 * 86400000), graceEnd: new Date(Date.now() - 86400000) } });
    const me = await t.admin.get('/auth/me');
    expect(me.body.data.entitlements.status).toBe('EXPIRED');
    expect(me.body.data.entitlements.readOnly).toBe(true);
    const run = await t.admin.post('/payroll-runs', { frequency: 'MONTHLY', periodStart: '2026-01-01', periodEnd: '2026-01-31', payDate: '2026-01-31' });
    expect(run.status).toBe(402);
    expect(run.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
    expect((await t.admin.post('/employees', employeeBody())).status).toBe(402);
    expect((await t.admin.get('/employees')).status).toBe(200);
    expect((await t.admin.get('/payslips')).status).toBe(200);
    expect((await t.admin.get('/subscription')).status).toBe(200);
    expect(await ctx.prisma.employee.count({ where: { tenantId: t.tenantId } })).toBe(1); // nothing deleted
    // grace period still allows writes
    await ctx.prisma.subscription.update({ where: { id: subscriptionId }, data: { graceEnd: new Date(Date.now() + 86400000) } });
    const grace = await t.admin.get('/auth/me');
    expect(grace.body.data.entitlements.status).toBe('GRACE');
    expect((await t.admin.post('/employees', employeeBody())).status).toBe(201);
  });

  it('suspension blocks writes; revocation locks business reads; reinstatement restores access', async () => {
    const t = await registerTenant(ctx);
    const { subscriptionId, verifier } = await upgradeTenant(ctx, t.tenantId, 'STARTER');
    await verifier.client.post(`/platform/subscriptions/${subscriptionId}/suspend`, { reason: 'Non-payment' });
    expect((await t.admin.post('/employees', employeeBody())).status).toBe(402);
    expect((await t.admin.get('/employees')).status).toBe(200);
    await verifier.client.post(`/platform/subscriptions/${subscriptionId}/revoke`, { reason: 'Contract terminated' });
    expect((await t.admin.get('/employees')).status).toBe(402);
    expect((await t.admin.get('/subscription')).status).toBe(200);
    await verifier.client.post(`/platform/subscriptions/${subscriptionId}/reinstate`, { reason: 'Resolved' });
    expect((await t.admin.post('/employees', employeeBody())).status).toBe(201);
  });

  it('platform staff cannot see tenant HR data through platform routes', async () => {
    const t = await registerTenant(ctx);
    await t.admin.post('/employees', employeeBody({ firstName: 'Secretive' }));
    const staff = await createPlatformStaff(ctx);
    const usage = await staff.client.get('/platform/usage');
    expect(usage.status).toBe(200);
    expect(JSON.stringify(usage.body)).not.toContain('Secretive');
    const tenantRoute = await staff.client.get('/employees');
    expect(tenantRoute.status).toBe(401);
    const { client: emp } = await addMember(ctx, t.tenantId, ['EMPLOYEE']);
    expect((await emp.get('/subscription')).status).toBe(403);
    void Client;
  });
});
