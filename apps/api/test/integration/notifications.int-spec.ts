import { LicensingCore } from '../../src/licensing/licensing-core.service';
import { NotificationService } from '../../src/notifications/notification.service';
import { TestContext, addMember, bootstrap, employeeBody, registerTenant, upgradeTenant } from './helpers';

function nextWeekday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe('Notifications (NFR-012)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await bootstrap();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('approval requests reach approvers (not the requester); decisions reach the employee; email honours preferences', async () => {
    const t = await registerTenant(ctx);
    await upgradeTenant(ctx, t.tenantId);
    const emp = await t.admin.post('/employees', employeeBody({ firstName: 'Nia', lastName: 'Ramsay' }));
    const staff = await addMember(ctx, t.tenantId, ['EMPLOYEE'], emp.body.data.id);
    const hr = await addMember(ctx, t.tenantId, ['HR_OFFICER']);
    const unpaid = (await t.admin.get('/leave/types')).body.data.find((x: any) => x.code === 'UNPD');
    const day = nextWeekday();
    const req = await staff.client.post('/leave/requests', { leaveTypeId: unpaid.id, startDate: day, endDate: day, reason: 'Family matter' });
    expect(req.status).toBe(201);

    const hrInbox = await hr.client.get('/notifications');
    expect(hrInbox.body.meta.unread).toBeGreaterThanOrEqual(1);
    const n = hrInbox.body.data.find((x: any) => x.type === 'leave_submitted');
    expect(n).toMatchObject({ category: 'approvals', title: 'Leave request awaiting approval: Nia Ramsay', link: '/app/leave' });
    expect((await staff.client.get('/notifications')).body.data.some((x: any) => x.type === 'leave_submitted')).toBe(false);

    // Emails: HR opts out of approval emails; admin keeps them
    expect((await hr.client.put('/notifications/preferences', { email: { approvals: false } })).status).toBe(200);
    const prefs = (await hr.client.get('/notifications/preferences')).body.data;
    expect(prefs.find((p: any) => p.key === 'approvals').email).toBe(false);
    expect(prefs.find((p: any) => p.key === 'subscription')).toMatchObject({ mandatory: true, email: true });
    await ctx.app.get(NotificationService).deliverPending();
    const hrRow = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: hr.userId, type: 'leave_submitted' } });
    expect(hrRow.emailStatus).toBe('SKIPPED');
    const adminUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: t.email } });
    expect((await ctx.prisma.notification.findFirstOrThrow({ where: { userId: adminUser.id, type: 'leave_submitted' } })).emailStatus).toBe('SENT');
    expect(ctx.mail.outbox.some((m) => m.to === t.email && m.template === 'notify_leave_submitted' && m.subject.includes('Nia Ramsay'))).toBe(true);

    // Decision goes to the employee, not to the approver who made it
    expect((await hr.client.post(`/leave/requests/${req.body.data.id}/approve`, { comment: 'Enjoy' })).status).toBe(200);
    const mine = (await staff.client.get('/notifications')).body.data;
    expect(mine.find((x: any) => x.type === 'leave_approved')).toMatchObject({ category: 'decisions', title: 'Leave request approved' });
    expect(mine.find((x: any) => x.type === 'leave_approved').body).toMatch(/Comment: “Enjoy”/);

    // read / read-all, scoped to the user
    const id = mine[0].id;
    expect((await hr.client.post(`/notifications/${id}/read`)).status).toBe(404);
    expect((await staff.client.post(`/notifications/${id}/read`)).status).toBe(200);
    expect((await staff.client.post('/notifications/read-all')).status).toBe(200);
    expect((await staff.client.get('/notifications')).body.meta.unread).toBe(0);
  });

  it('subscription expiry reminders go to company administrators once per milestone; expiry notifies too', async () => {
    const t = await registerTenant(ctx);
    const { subscriptionId } = await upgradeTenant(ctx, t.tenantId, 'STARTER');
    const now = new Date();
    await ctx.prisma.subscription.update({ where: { id: subscriptionId }, data: { periodEnd: new Date(now.getTime() + 5 * 86_400_000), graceEnd: new Date(now.getTime() + 19 * 86_400_000) } });
    const licensing = ctx.app.get(LicensingCore);
    await licensing.sendExpiryReminders(now);
    await licensing.sendExpiryReminders(now);
    const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: t.email } });
    const reminders = await ctx.prisma.notification.findMany({ where: { userId: admin.id, type: 'subscription_expiring' } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].title).toMatch(/ends in 5 days/);

    await ctx.prisma.subscription.update({ where: { id: subscriptionId }, data: { periodEnd: new Date(now.getTime() - 40 * 86_400_000), graceEnd: new Date(now.getTime() - 10 * 86_400_000) } });
    await licensing.sweepExpirations(now);
    const expired = await ctx.prisma.notification.findFirst({ where: { userId: admin.id, type: 'subscription_expired' } });
    expect(expired?.title).toMatch(/read-only/);
  });
});
