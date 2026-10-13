import { expect, test } from '@playwright/test';
import { ADMIN, HRMS, PASSWORD, createStaff, prisma, staffLogin, totp, uniq, verificationLink } from './fixtures';

test.afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Journey 1 (PRD §5.1, AC-01, AC-02): Start Free → verify email → sign in → mandatory MFA enrolment →
 * Free plan dashboard → add employees up to the Free limit; the sixth is refused by the API.
 */
test('Free company onboarding, MFA and employee limit', async ({ page }) => {
  const company = uniq('Coral Reef Bakery ');
  const email = `${uniq('owner')}@e2e.test`;
  await page.goto(HRMS);
  await page.getByRole('link', { name: 'Start Free' }).first().click();
  await page.getByLabel('Registered (legal) name').fill(`${company} Limited`);
  await page.getByLabel('Display name').fill(company);
  await page.getByLabel('Your full name').fill('Olivia Owner');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create company workspace' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  await page.goto(await verificationLink(email));
  await expect(page.getByText('Email verified')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Company administrators must enrol MFA before using the app (SEC-006)
  await page.waitForURL(/\/mfa\/setup/);
  const secret = (await page.locator('code').first().textContent())!.trim();
  await page.getByLabel('6-digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirm & enable' }).click();
  await page.waitForURL(`${HRMS}/app`);
  await expect(page.getByText(company).first()).toBeVisible(); // HR-002 company name in shell
  await expect(page.getByText('Free plan · free')).toBeVisible();

  for (let i = 1; i <= 6; i++) {
    await page.goto(`${HRMS}/app/employees`);
    await page.getByRole('button', { name: 'Add employee' }).first().click();
    await page.getByLabel('First name').fill(`Worker${i}`);
    await page.getByLabel('Last name').fill('Tester');
    await page.getByLabel('Salary per pay period (JMD)').fill('120000');
    await page.getByRole('button', { name: 'Create employee' }).click();
    if (i <= 5) {
      await expect(page.getByText('Employee created')).toBeVisible();
      await page.waitForURL(/\/app\/employees\/.+/);
    } else {
      await expect(page.getByText(/Free plan allows 5 active employees/)).toBeVisible();
    }
  }
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { displayName: company } });
  expect(await prisma.employee.count({ where: { tenantId: tenant.id } })).toBe(5);
  // Payroll is not entitled on Free: the nav item routes to Subscription
  await page.goto(`${HRMS}/app/subscription`);
  await expect(page.getByText('Free plan', { exact: true })).toBeVisible();
});

/**
 * Journey 2 (PRD §5.2, AC-03, AC-04): Qwik officer records a manual payment → a different officer verifies it →
 * creates a paid subscription → generates a one-time code (shown once) → the tenant admin redeems it in YardHRMS.
 */
test('Manual payment, verification, activation code and tenant redemption', async ({ browser }) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'negril-beach-services' } });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { tenantId: tenant.id } });
  const officer = await createStaff('PLATFORM_LICENSING_OFFICER');
  const admin = await createStaff('PLATFORM_SUPER_ADMIN');
  const reference = uniq('BT-');

  const officerPage = await (await browser.newContext()).newPage();
  await staffLogin(officerPage, officer);
  await officerPage.goto(`${ADMIN}/customers/${customer.id}`);
  await officerPage.getByRole('button', { name: 'Record payment' }).click();
  await officerPage.getByLabel('Receipt / bank reference').fill(reference);
  await officerPage.getByLabel('Amount').fill('25000');
  await officerPage.getByRole('button', { name: 'Record payment' }).last().click();
  await expect(officerPage.getByText('You recorded this payment')).toBeVisible();
  await expect(officerPage.getByRole('button', { name: 'Verify' })).toBeDisabled(); // separation of duties

  const adminPage = await (await browser.newContext()).newPage();
  await staffLogin(adminPage, admin);
  const payment = await prisma.manualPayment.findFirstOrThrow({ where: { reference } });
  await adminPage.goto(`${ADMIN}/payments/${payment.id}`);
  await adminPage.getByRole('button', { name: 'Verify' }).click();
  await adminPage.getByRole('dialog').getByRole('button', { name: 'Verify payment' }).click();
  await expect(adminPage.getByText('Payment updated')).toBeVisible();

  await adminPage.goto(`${ADMIN}/customers/${customer.id}`);
  await adminPage.getByRole('button', { name: 'New subscription' }).click();
  const dialog = adminPage.getByRole('dialog');
  const starter = await prisma.plan.findUniqueOrThrow({ where: { code: 'STARTER' } });
  await dialog.getByLabel('Plan').selectOption(starter.id);
  await dialog.getByRole('button', { name: 'Create subscription' }).click();
  await adminPage.waitForURL(/\/subscriptions\/.+/);
  await adminPage.getByRole('button', { name: 'Generate activation code' }).click();
  await adminPage.getByRole('dialog').getByRole('button', { name: 'Generate' }).click();
  const code = (await adminPage.locator('code').filter({ hasText: /^QWK-/ }).textContent())!.trim();
  expect(code).toMatch(/^QWK-[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/);

  // Tenant admin (demo seed, MFA secret known for development) redeems the code
  const tenantPage = await (await browser.newContext()).newPage();
  await tenantPage.goto(`${HRMS}/login`);
  await tenantPage.getByLabel('Email').fill('owner@negrilbeach.demo');
  await tenantPage.getByLabel('Password').fill('Demo!Pass2026');
  await tenantPage.getByRole('button', { name: 'Sign in' }).click();
  await tenantPage.getByLabel('6-digit code').fill(totp('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'));
  await tenantPage.getByRole('button', { name: 'Verify' }).click();
  await tenantPage.waitForURL(`${HRMS}/app`);
  await tenantPage.goto(`${HRMS}/app/subscription`);
  await tenantPage.getByLabel('Authorization code').fill(code);
  await tenantPage.getByRole('button', { name: 'Redeem code' }).click();
  await expect(tenantPage.getByText('Subscription activated')).toBeVisible();
  await expect(tenantPage.getByText('Starter plan').first()).toBeVisible();

  // Replay is rejected
  await tenantPage.getByLabel('Authorization code').fill(code);
  await tenantPage.getByRole('button', { name: 'Redeem code' }).click();
  await expect(tenantPage.getByText(/already been used/)).toBeVisible();
});

const DEMO_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
async function demoLogin(page: import('@playwright/test').Page, email: string, mfa: boolean) {
  await page.goto(`${HRMS}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Demo!Pass2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (mfa) {
    await page.getByLabel('6-digit code').fill(totp(DEMO_SECRET));
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await page.waitForURL(`${HRMS}/app`);
}

/**
 * Journey 3 (AC-07, AC-08, AC-10, PAY-007): a Manager enters a delegated timesheet → an Admin approves it →
 * the Payroll Officer prepares a weekly run → the Finance Approver reviews, approves and locks it →
 * the Manager prints the approved payslip, which is audited.
 */
test('Delegated timesheet through payroll approval to an audited payslip print', async ({ browser }) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'blue-mountain-traders' } });
  const omar = await prisma.employee.findFirstOrThrow({ where: { tenantId: tenant.id, firstName: 'Omar' } });
  // Choose an unused historical week (weekly periods start Monday)
  let monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  for (let back = 10 + Math.floor(Math.random() * 40); ; back++) {
    const m = new Date(monday.getTime() - back * 7 * 86400000);
    const used =
      (await prisma.payrollPeriod.findFirst({ where: { tenantId: tenant.id, frequency: 'WEEKLY', periodStart: m } })) ||
      (await prisma.timesheet.findFirst({ where: { tenantId: tenant.id, employeeId: omar.id, workDate: { gte: m, lte: new Date(m.getTime() + 6 * 86400000) } } }));
    if (!used) {
      monday = m;
      break;
    }
  }
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const workDate = iso(new Date(monday.getTime() + 86400000)); // Tuesday

  // 1. Manager submits on Omar's behalf
  const mgr = await (await browser.newContext()).newPage();
  await demoLogin(mgr, 'manager@bluemountain.demo', false);
  await mgr.goto(`${HRMS}/app/timesheets`);
  await mgr.getByRole('button', { name: 'New timesheet' }).click();
  const dlg = mgr.getByRole('dialog');
  const picker = dlg.getByPlaceholder(/search/i).first();
  await picker.click();
  await picker.fill('Omar');
  await dlg.getByRole('option', { name: /Omar Clarke/ }).click();
  await dlg.getByLabel('Work date').fill(workDate);
  await dlg.getByRole('textbox', { name: 'Start', exact: true }).fill('08:00');
  await dlg.getByRole('textbox', { name: 'End', exact: true }).fill('17:00');
  await dlg.getByLabel('Break (hours)').fill('1');
  await dlg.getByRole('button', { name: 'Submit' }).click();
  await expect(mgr.getByText('Timesheet submitted')).toBeVisible();
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: 'manager@bluemountain.demo' } });
  const ts = await prisma.timesheet.findFirstOrThrow({ where: { tenantId: tenant.id, employeeId: omar.id, workDate: new Date(`${workDate}T00:00:00Z`), status: 'PENDING' } });
  expect(ts.submittedByUserId).toBe(manager.id);
  expect(ts.delegated).toBe(true);

  // 2. Admin approves (the manager cannot approve their own submission — separation of duties)
  const admin = await (await browser.newContext()).newPage();
  await demoLogin(admin, 'admin@bluemountain.demo', true);
  const approve = await admin.request.post(`${HRMS}/api/v1/timesheets/${ts.id}/approve`, {
    headers: { 'X-CSRF-Token': (await (await admin.request.get(`${HRMS}/api/v1/auth/me`)).json()).data.csrfToken },
    data: {},
  });
  expect(approve.status()).toBe(200);

  // 3. Payroll officer creates and prepares the weekly run
  const payroll = await (await browser.newContext()).newPage();
  await demoLogin(payroll, 'payroll@bluemountain.demo', true);
  await payroll.goto(`${HRMS}/app/payroll/runs`);
  await payroll.getByRole('button', { name: 'New payroll run' }).click();
  const runDlg = payroll.getByRole('dialog');
  await runDlg.getByLabel('Pay frequency').selectOption('WEEKLY');
  await runDlg.getByLabel('Period start').fill(iso(monday));
  await runDlg.getByLabel('Period end').fill(iso(sunday));
  await runDlg.getByLabel('Pay date').fill(iso(sunday));
  await runDlg.getByRole('button', { name: 'Create run' }).click();
  await payroll.waitForURL(/\/app\/payroll\/runs\/.+/);
  const runUrl = payroll.url();
  await payroll.getByRole('button', { name: 'Calculate & prepare' }).click();
  await expect(payroll.getByText('Omar Clarke')).toBeVisible();
  await expect(payroll.getByRole('button', { name: 'Mark reviewed' })).toHaveCount(0); // payroll officer lacks review permission

  // 4. Finance approver reviews, approves and locks
  const fin = await (await browser.newContext()).newPage();
  await demoLogin(fin, 'finance@bluemountain.demo', true);
  await fin.goto(runUrl);
  await fin.getByRole('button', { name: 'Mark reviewed' }).click();
  await fin.getByRole('button', { name: 'Approve', exact: true }).click();
  await fin.getByRole('dialog').getByRole('button', { name: 'Approve payroll' }).click();
  await expect(fin.getByText('Approval trail')).toBeVisible();
  await fin.getByRole('button', { name: 'Lock', exact: true }).click();
  await fin.getByRole('dialog').getByRole('button', { name: 'Lock payroll' }).click();
  await expect(fin.locator('span', { hasText: /^Locked$/ }).first()).toBeVisible();
  const runId = runUrl.split('/').pop()!;
  const snap = await prisma.payrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId: omar.id } });
  expect(snap.regularHours.toString()).toBe('8');
  expect((snap.calculation as any).ruleVersionId).toBeTruthy();

  // 5. Manager prints the approved payslip; the print is audited with user, employee and tenant
  await mgr.goto(`${HRMS}/app/payslips`);
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runUrl.split('/').pop()! } });
  await mgr.getByLabel('Year').selectOption('');
  const row = mgr.locator('tr', { hasText: 'Omar Clarke' }).filter({ hasText: run.runNumber }).first();
  const popup = mgr.waitForEvent('popup').catch(() => null);
  await row.getByRole('button', { name: 'Print' }).click();
  await popup;
  const slip = await prisma.payslip.findFirstOrThrow({ where: { runId, employeeId: omar.id } });
  await expect.poll(async () => prisma.payslipAccessEvent.count({ where: { payslipId: slip.id, userId: manager.id, action: 'PRINT', tenantId: tenant.id } })).toBe(1);
});
