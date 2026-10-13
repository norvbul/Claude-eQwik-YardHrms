import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authenticator } from 'otplib';
import { createApp } from '../../src/app.factory';
import { MailService } from '../../src/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PasswordService } from '../../src/auth/password.service';
import { ProvisioningService } from '../../src/tenancy/provisioning.service';
import { seedPlatform } from '../../src/seed/seed';
import { JobsService } from '../../src/jobs/jobs.service';
import { resetConfigCache } from '../../src/config/config';

export const PASSWORD = 'Str0ng!Passw0rd';

export interface TestContext {
  app: INestApplication;
  server: any;
  prisma: PrismaService;
  mail: MailService;
  jobs: JobsService;
}

export async function bootstrap(): Promise<TestContext> {
  resetConfigCache();
  const app = await createApp({ logger: false });
  await app.init();
  const prisma = app.get(PrismaService);
  await seedPlatform(prisma, app.get(ProvisioningService));
  return { app, server: app.getHttpServer(), prisma, mail: app.get(MailService), jobs: app.get(JobsService) };
}

/** Cookie-jar client that sends the session CSRF token on writes, like the React apps do. */
export class Client {
  agent: ReturnType<typeof request.agent>;
  csrf = '';
  constructor(
    private readonly ctx: TestContext,
    public readonly kind: 'TENANT' | 'PLATFORM' = 'TENANT',
  ) {
    this.agent = request.agent(ctx.server);
  }

  private base(path: string) {
    return `/api/v1${path}`;
  }

  async refreshCsrf() {
    const res = await this.agent.get(this.base(this.kind === 'PLATFORM' ? '/platform/auth/me' : '/auth/me'));
    if (res.body?.data?.csrfToken) this.csrf = res.body.data.csrfToken;
    return res;
  }

  get(path: string) {
    return this.agent.get(this.base(path));
  }
  post(path: string, body?: unknown) {
    return this.agent.post(this.base(path)).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  patch(path: string, body?: unknown) {
    return this.agent.patch(this.base(path)).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  put(path: string, body?: unknown) {
    return this.agent.put(this.base(path)).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  delete(path: string, body?: unknown) {
    return this.agent.delete(this.base(path)).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  upload(path: string, fileName: string, content: Buffer) {
    return this.agent.post(this.base(path)).set('X-CSRF-Token', this.csrf).attach('file', content, fileName);
  }

  async login(email: string, password = PASSWORD) {
    const res = await this.agent.post(this.base(this.kind === 'PLATFORM' ? '/platform/auth/login' : '/auth/login')).send({ email, password });
    if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    await this.refreshCsrf();
    return res.body.data as { mfaRequired: boolean };
  }

  /** Completes MFA: enrols when not yet enabled, otherwise answers the challenge. Returns the secret. */
  async completeMfa(secret?: string): Promise<string> {
    const prefix = this.kind === 'PLATFORM' ? '/platform/auth' : '/auth';
    if (secret) {
      const r = await this.post(`${prefix}/mfa/challenge`, { code: authenticator.generate(secret) });
      if (r.status !== 200) throw new Error(`MFA challenge failed ${JSON.stringify(r.body)}`);
    } else {
      const setup = await this.post(`${prefix}/mfa/setup`);
      if (setup.status !== 200) throw new Error(`MFA setup failed ${JSON.stringify(setup.body)}`);
      secret = setup.body.data.secret as string;
      const r = await this.post(`${prefix}/mfa/confirm`, { code: authenticator.generate(secret) });
      if (r.status !== 200) throw new Error(`MFA confirm failed ${JSON.stringify(r.body)}`);
    }
    await this.refreshCsrf();
    return secret!;
  }
}

let counter = 0;
export function uniq(prefix: string) {
  counter++;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

/** Registers a company through the public API, verifies the email and signs the admin in with MFA. */
export async function registerTenant(ctx: TestContext, name = uniq('Co')) {
  const email = `${name.toLowerCase()}@example.test`;
  const anon = new Client(ctx);
  const res = await anon.post('/auth/register', {
    companyLegalName: `${name} Limited`,
    companyDisplayName: name,
    fullName: `${name} Admin`,
    email,
    password: PASSWORD,
    acceptTerms: true,
  });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  const msg = [...ctx.mail.outbox].reverse().find((m) => m.to === email && m.template === 'email_verify');
  const token = decodeURIComponent(/token=([^\s&]+)/.exec(msg!.text)![1]);
  const v = await anon.post('/auth/verify-email', { token });
  if (v.status !== 200) throw new Error(`verify failed ${JSON.stringify(v.body)}`);
  const admin = new Client(ctx);
  await admin.login(email);
  const secret = await admin.completeMfa();
  const me = await admin.refreshCsrf();
  return { admin, email, secret, tenantId: me.body.data.activeTenant.id as string, name };
}

/** Creates (directly) a verified user with membership + roles in a tenant and returns a signed-in client. */
export async function addMember(ctx: TestContext, tenantId: string, roleCodes: string[], employeeId: string | null = null) {
  const email = `${uniq('user')}@example.test`;
  const passwords = ctx.app.get(PasswordService);
  const user = await ctx.prisma.user.create({ data: { email, fullName: `Member ${email}`, passwordHash: await passwords.hash(PASSWORD), emailVerifiedAt: new Date() } });
  const roles = await ctx.prisma.role.findMany({ where: { tenantId, code: { in: roleCodes } } });
  await ctx.prisma.tenantMembership.create({ data: { tenantId, userId: user.id, status: 'ACTIVE', employeeId, roles: { create: roles.map((r) => ({ roleId: r.id })) } } });
  const c = new Client(ctx);
  await c.login(email);
  const privileged = roles.some((r) => r.privileged);
  if (privileged) await c.completeMfa();
  await c.refreshCsrf();
  return { client: c, userId: user.id, email };
}

export async function createPlatformStaff(ctx: TestContext, role: 'PLATFORM_SUPER_ADMIN' | 'PLATFORM_LICENSING_OFFICER' = 'PLATFORM_SUPER_ADMIN') {
  const email = `${uniq('staff')}@qwik.test`;
  const passwords = ctx.app.get(PasswordService);
  const user = await ctx.prisma.user.create({ data: { email, fullName: 'Qwik Staff', passwordHash: await passwords.hash(PASSWORD), emailVerifiedAt: new Date(), platformRole: role } });
  const c = new Client(ctx, 'PLATFORM');
  await c.login(email);
  await c.completeMfa();
  return { client: c, userId: user.id };
}

export function employeeBody(over: Record<string, unknown> = {}) {
  return {
    employeeNumber: uniq('E').toUpperCase().slice(0, 20),
    firstName: 'Test',
    lastName: uniq('Person'),
    hireDate: '2025-01-06',
    payFrequency: 'MONTHLY',
    payType: 'SALARY',
    salaryPerPeriod: '200000.00',
    overtimeEligible: true,
    ...over,
  };
}

/** Upgrades a tenant to a paid plan through the platform flow (payment → verify → subscription → direct activation). */
export async function upgradeTenant(ctx: TestContext, tenantId: string, planCode = 'PROFESSIONAL') {
  const recorder = await createPlatformStaff(ctx, 'PLATFORM_LICENSING_OFFICER');
  const verifier = await createPlatformStaff(ctx, 'PLATFORM_SUPER_ADMIN');
  const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { tenantId } });
  const plan = await ctx.prisma.plan.findUniqueOrThrow({ where: { code: planCode } });
  const pay = await recorder.client.post('/platform/payments', {
    customerId: customer.id,
    planId: plan.id,
    reference: uniq('REF'),
    paymentDate: '2026-01-10',
    amount: '1000.00',
    currency: 'JMD',
    method: 'BANK_TRANSFER',
  });
  if (pay.status !== 201) throw new Error(JSON.stringify(pay.body));
  const ver = await verifier.client.post(`/platform/payments/${pay.body.data.id}/verify`, {});
  if (ver.status !== 200) throw new Error(JSON.stringify(ver.body));
  const sub = await verifier.client.post('/platform/subscriptions', { customerId: customer.id, planId: plan.id, paymentId: pay.body.data.id, applyToTenantDirectly: true });
  if (sub.status !== 201) throw new Error(JSON.stringify(sub.body));
  return { subscriptionId: sub.body.data.id as string, verifier, recorder };
}

/** Creates and approves a statutory rule version with SYNTHETIC test rates (not statutory values). */
export async function approvedSyntheticRules(ctx: TestContext, author: Client, approver: Client) {
  const create = await author.post('/payroll/statutory-versions', {
    name: 'Synthetic test rules',
    effectiveFrom: '2025-01-01',
    components: [
      { code: 'C1', name: 'Synthetic 1', sortOrder: 10, base: 'TAXABLE_GROSS', employeeRate: '0.05', employerRate: '0.05', reducesStatutoryIncome: true, brackets: [] },
      { code: 'TAX', name: 'Synthetic tax', sortOrder: 20, base: 'STATUTORY_INCOME', employeeRate: '0', employerRate: '0', annualThreshold: '600000', brackets: [{ upToAnnual: null, rate: '0.25' }] },
    ],
  });
  if (create.status !== 201) throw new Error(JSON.stringify(create.body));
  const approve = await approver.post(`/payroll/statutory-versions/${create.body.data.id}/approve`, { attestation: 'Synthetic integration-test rates, not statutory values.' });
  if (approve.status !== 200) throw new Error(JSON.stringify(approve.body));
  return create.body.data.id as string;
}
