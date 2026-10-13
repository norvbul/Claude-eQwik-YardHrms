/* eslint-disable no-console */
import 'reflect-metadata';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: process.env.DOTENV_PATH ?? path.resolve(__dirname, '../../../../.env'), quiet: true });

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { authenticator } from 'otplib';
import { FEATURE_CATALOG, SEED_PLANS } from '@yardhrms/authorization';
import { AppModule } from '../app.module';
import { PasswordService } from '../auth/password.service';
import { CryptoService } from '../common/crypto.service';
import { loadConfig } from '../config/config';
import { LicensingCore } from '../licensing/licensing-core.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningService } from '../tenancy/provisioning.service';
import { EmployeesService } from '../employees/employees.service';

const D = Prisma.Decimal;

/** Idempotent platform seed: permissions, features, product, plans and the initial Qwik super admin. */
export async function seedPlatform(prisma: PrismaService, provisioning: ProvisioningService) {
  await provisioning.ensurePermissions();
  for (const f of FEATURE_CATALOG) {
    await prisma.feature.upsert({ where: { code: f.code }, create: f, update: { name: f.name, description: f.description } });
  }
  const product = await prisma.product.upsert({
    where: { code: 'YARDHRMS' },
    create: { code: 'YARDHRMS', name: 'eQwik YardHRMS', description: 'HR & Payroll SaaS for Jamaican businesses' },
    update: {},
  });
  for (const p of SEED_PLANS) {
    const existing = await prisma.plan.findUnique({ where: { code: p.code } });
    if (existing) {
      // never overwrite values edited in the Licence Manager; only fill a price that was never set
      if (existing.price === null && p.proposedPrice !== null) await prisma.plan.update({ where: { id: existing.id }, data: { price: p.proposedPrice } });
      continue;
    }
    await prisma.plan.create({
      data: {
        productId: product.id,
        code: p.code,
        name: p.name,
        isFree: p.isFree,
        price: p.proposedPrice, // proposed pricing (docs/pricing.md); editable in the Licence Manager
        currency: 'JMD',
        durationMonths: p.durationMonths,
        employeeLimit: p.employeeLimit,
        userLimit: p.userLimit,
        gracePeriodDays: p.gracePeriodDays,
        features: { create: p.features.map((featureCode) => ({ featureCode })) },
      },
    });
  }
  return product;
}

async function main() {
  const config = loadConfig();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const provisioning = app.get(ProvisioningService);
  const passwords = app.get(PasswordService);
  const crypto = app.get(CryptoService);
  const licensing = app.get(LicensingCore);
  const employees = app.get(EmployeesService);

  await seedPlatform(prisma, provisioning);
  console.log('✔ Permissions, features, product and plans seeded');

  const adminEmail = process.env.SEED_PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.SEED_PLATFORM_ADMIN_PASSWORD;
  let platformAdminId: string | null = null;
  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12) throw new Error('SEED_PLATFORM_ADMIN_PASSWORD must be at least 12 characters');
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existing) {
      const u = await prisma.user.create({
        data: { email: adminEmail, fullName: 'Qwik Platform Administrator', passwordHash: await passwords.hash(adminPassword), emailVerifiedAt: new Date(), platformRole: 'PLATFORM_SUPER_ADMIN' },
      });
      platformAdminId = u.id;
      console.log(`✔ Platform super admin created: ${adminEmail} (MFA enrolment required at first sign-in)`);
    } else {
      platformAdminId = existing.id;
      console.log(`• Platform super admin exists: ${adminEmail}`);
    }
  }

  if (process.env.SEED_DEMO_TENANT === 'true') {
    if (config.isProduction) throw new Error('Refusing to seed demo data in production');
    await seedDemo({ prisma, provisioning, passwords, crypto, licensing, employees, platformAdminId });
  }
  await app.close();
}

const DEMO_PASSWORD = 'Demo!Pass2026';
/** Development-only TOTP secret for demo privileged users (printed so developers can enrol an authenticator). */
const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

async function seedDemo(ctx: {
  prisma: PrismaService;
  provisioning: ProvisioningService;
  passwords: PasswordService;
  crypto: CryptoService;
  licensing: LicensingCore;
  employees: EmployeesService;
  platformAdminId: string | null;
}) {
  const { prisma, provisioning, passwords, crypto, licensing, employees } = ctx;
  const exists = await prisma.tenant.findUnique({ where: { slug: 'blue-mountain-traders' } });
  if (exists) {
    console.log('• Demo tenant already present — skipping demo seed');
    return;
  }
  const hash = await passwords.hash(DEMO_PASSWORD);
  const mfaEnc = crypto.encrypt(DEMO_TOTP_SECRET);
  const mkUser = (email: string, fullName: string, mfa: boolean) =>
    prisma.user.create({ data: { email, fullName, passwordHash: hash, emailVerifiedAt: new Date(), ...(mfa ? { mfaSecretEnc: mfaEnc, mfaEnabledAt: new Date() } : {}) } });

  const admin = await mkUser('admin@bluemountain.demo', 'Andrea Campbell', true);
  const { tenant } = await prisma.tx(
    (tx) =>
      provisioning.provisionTenant(tx, {
        legalName: 'Blue Mountain Traders Limited (DEMO)',
        displayName: 'Blue Mountain Traders',
        adminUserId: admin.id,
        email: 'admin@bluemountain.demo',
        contactName: 'Andrea Campbell',
      }),
    { timeout: 60_000 },
  );
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { slug: 'blue-mountain-traders', addressLine1: '12 Demo Avenue', city: 'Kingston', parish: 'St. Andrew', phone: '876-555-0100', accentColor: '#0b5d3b' },
  });
  const t = tenant.id;
  const roles = Object.fromEntries((await prisma.role.findMany({ where: { tenantId: t } })).map((r) => [r.code, r.id]));

  // Master data
  const dept = async (code: string, name: string) => (await prisma.department.create({ data: { tenantId: t, code, name } })).id;
  const D_ADMIN = await dept('ADM', 'Administration');
  const D_FIN = await dept('FIN', 'Finance');
  const D_OPS = await dept('OPS', 'Operations');
  const D_SALES = await dept('SAL', 'Sales');
  const HQ = (await prisma.branch.create({ data: { tenantId: t, code: 'HQ', name: 'Head Office', parish: 'St. Andrew' } })).id;
  const MBJ = (await prisma.branch.create({ data: { tenantId: t, code: 'MBJ', name: 'Montego Bay', parish: 'St. James' } })).id;
  const pos = async (code: string, name: string, departmentId: string) => (await prisma.position.create({ data: { tenantId: t, code, name, departmentId } })).id;
  const P_MGR = await pos('MGR', 'Manager', D_ADMIN);
  const P_ACC = await pos('ACC', 'Accountant', D_FIN);
  const P_SUP = await pos('SUP', 'Supervisor', D_OPS);
  const P_OPR = await pos('OPR', 'Operator', D_OPS);
  const P_REP = await pos('REP', 'Sales Representative', D_SALES);
  await prisma.shiftType.createMany({
    data: [
      { tenantId: t, code: 'DAY', name: 'Day shift', defaultStart: '08:00', defaultEnd: '16:30' },
      { tenantId: t, code: 'NIGHT', name: 'Night shift', defaultStart: '22:00', defaultEnd: '06:00' },
    ],
  });
  const year = new Date().getUTCFullYear();
  // Fixed-date public holidays only (moveable holidays must be entered by the company each year).
  await prisma.publicHoliday.createMany({
    data: [
      { tenantId: t, date: new Date(Date.UTC(year, 0, 1)), name: "New Year's Day" },
      { tenantId: t, date: new Date(Date.UTC(year, 7, 1)), name: 'Emancipation Day' },
      { tenantId: t, date: new Date(Date.UTC(year, 7, 6)), name: 'Independence Day' },
      { tenantId: t, date: new Date(Date.UTC(year, 11, 25)), name: 'Christmas Day' },
      { tenantId: t, date: new Date(Date.UTC(year, 11, 26)), name: 'Boxing Day' },
    ],
    skipDuplicates: true,
  });
  await prisma.overtimeRule.createMany({
    data: [
      { tenantId: t, code: 'OT15', name: 'Standard overtime', multiplier: new D('1.5'), description: 'Demo default — confirm against company policy and applicable law' },
      { tenantId: t, code: 'OT20', name: 'Rest day / public holiday', multiplier: new D('2.0'), description: 'Demo default — confirm against company policy and applicable law' },
    ],
  });
  await prisma.allowanceType.createMany({
    data: [
      { tenantId: t, code: 'TRAVEL', name: 'Travel allowance', taxable: true },
      { tenantId: t, code: 'MEAL', name: 'Meal allowance', taxable: true },
    ],
  });
  await prisma.deductionType.createMany({
    data: [
      { tenantId: t, code: 'PENSION', name: 'Approved pension', category: 'PENSION', preTax: true },
      { tenantId: t, code: 'LOAN', name: 'Staff loan', category: 'LOAN', preTax: false },
      { tenantId: t, code: 'UNION', name: 'Union dues', category: 'UNION', preTax: false },
    ],
  });
  const vac = await prisma.leaveType.findFirstOrThrow({ where: { tenantId: t, code: 'VAC' } });
  const sick = await prisma.leaveType.findFirstOrThrow({ where: { tenantId: t, code: 'SICK' } });
  await prisma.leavePolicy.createMany({
    data: [
      { tenantId: t, leaveTypeId: vac.id, annualEntitlementDays: new D(12), accrualMethod: 'ANNUAL_GRANT', carryForwardMaxDays: new D(5), carryForwardExpiryMonths: 3, effectiveFrom: new Date(Date.UTC(year - 1, 0, 1)), notes: 'DEMO policy values — configure your own policy' },
      { tenantId: t, leaveTypeId: sick.id, annualEntitlementDays: new D(8), accrualMethod: 'ANNUAL_GRANT', carryForwardMaxDays: new D(0), effectiveFrom: new Date(Date.UTC(year - 1, 0, 1)), notes: 'DEMO policy values — configure your own policy' },
    ],
  });

  // DEMO statutory rules: synthetic round-number rates purely to exercise the engine. NOT Jamaican statutory rates.
  const demoVersion = await prisma.statutoryRuleVersion.create({
    data: {
      tenantId: t,
      name: 'DEMO ONLY — synthetic rates (NOT statutory)',
      effectiveFrom: new Date(Date.UTC(year - 1, 0, 1)),
      status: 'APPROVED',
      sourceReference: 'Synthetic demonstration values. Replace with verified rates from TAJ / NIS / NHT before any live payroll.',
      attestation: 'Demo data only — not reviewed by a payroll specialist. Not valid for production payroll.',
      createdById: admin.id,
      approvedAt: new Date(),
      approvedById: ctx.platformAdminId ?? admin.id,
    },
  });
  const comp = (code: string, name: string, sortOrder: number, base: 'GROSS' | 'TAXABLE_GROSS' | 'STATUTORY_INCOME', er: string, emp: string, extra: Partial<Prisma.StatutoryComponentUncheckedCreateInput> = {}) =>
    prisma.statutoryComponent.create({
      data: { tenantId: t, versionId: demoVersion.id, code, name, sortOrder, base, employeeRate: new D(emp), employerRate: new D(er), notes: 'DEMO synthetic value', ...extra },
    });
  await comp('NIS', 'National Insurance Scheme (DEMO)', 10, 'TAXABLE_GROSS', '0.03', '0.03', { annualCeiling: new D('3000000'), reducesStatutoryIncome: true });
  await comp('NHT', 'National Housing Trust (DEMO)', 20, 'GROSS', '0.03', '0.02');
  await comp('EDTAX', 'Education Tax (DEMO)', 30, 'STATUTORY_INCOME', '0.035', '0.02');
  const paye = await comp('PAYE', 'Income Tax PAYE (DEMO)', 40, 'STATUTORY_INCOME', '0', '0', { annualThreshold: new D('1500000') });
  await prisma.taxThreshold.createMany({
    data: [
      { componentId: paye.id, sequence: 1, upToAnnual: new D('4500000'), rate: new D('0.25') },
      { componentId: paye.id, sequence: 2, upToAnnual: null, rate: new D('0.30') },
    ],
  });
  await comp('HEART', 'HEART/NSTA Trust (DEMO, employer)', 50, 'GROSS', '0.03', '0');

  // Commercial: customer → verified manual payment → paid Professional subscription (activated directly)
  const customer = await prisma.customer.findUniqueOrThrow({ where: { tenantId: t } });
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PROFESSIONAL' } });
  const staffId = ctx.platformAdminId ?? admin.id;
  const payment = await prisma.manualPayment.create({
    data: {
      customerId: customer.id,
      tenantId: t,
      planId: plan.id,
      invoiceNumber: 'DEMO-INV-0001',
      reference: 'DEMO-BANK-TRANSFER-0001',
      paymentDate: new Date(),
      amount: new D('1.00'),
      currency: 'JMD',
      method: 'BANK_TRANSFER',
      notes: 'Demo payment record (nominal amount — commercial prices not set)',
      status: 'VERIFIED',
      recordedById: staffId,
      verifiedById: staffId,
      verifiedAt: new Date(),
      history: { create: [{ toStatus: 'PENDING', actorId: staffId, actorEmail: 'seed', reason: 'Recorded (demo seed)' }] },
    },
  });
  await prisma.manualPaymentEvent.create({ data: { paymentId: payment.id, fromStatus: 'PENDING', toStatus: 'VERIFIED', actorId: staffId, actorEmail: 'seed', reason: 'Verified (demo seed)' } });
  await prisma.tx(async (tx) => {
    const sub = await licensing.createPaidSubscription(tx, { customerId: customer.id, planId: plan.id, paymentId: payment.id, actorUserId: staffId, canOverride: false });
    await licensing.activate(tx, sub.id, t, staffId, 'DIRECT');
  });

  // Employees
  const actor = { tenantId: t, user: { id: admin.id, email: admin.email, fullName: admin.fullName } } as any;
  const mk = async (n: number, first: string, last: string, extra: Record<string, unknown>) =>
    prisma.tx((tx) =>
      employees.createInTx(tx, actor, {
        employeeNumber: `EMP-${String(n).padStart(4, '0')}`,
        firstName: first,
        lastName: last,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@bluemountain.demo`,
        hireDate: `${year - 2}-03-01`,
        dateOfBirth: `19${80 + n}-0${(n % 9) + 1}-1${n % 9}`,
        gender: n % 2 ? 'FEMALE' : 'MALE',
        parish: n % 2 ? 'Kingston' : 'St. Catherine',
        trn: `1${String(10000000 + n * 1111).slice(0, 8)}`,
        nisNumber: `A${100000 + n}`,
        overtimeEligible: true,
        statutoryExemptions: [],
        ...extra,
      } as any),
    );
  const e1 = await mk(1, 'Andrea', 'Campbell', { departmentId: D_ADMIN, branchId: HQ, positionId: P_MGR, payFrequency: 'MONTHLY', payType: 'SALARY', salaryPerPeriod: '450000.00', overtimeEligible: false });
  const e2 = await mk(2, 'Marcus', 'Reid', { departmentId: D_FIN, branchId: HQ, positionId: P_ACC, payFrequency: 'MONTHLY', payType: 'SALARY', salaryPerPeriod: '320000.00' });
  const e3 = await mk(3, 'Shanice', 'Williams', { departmentId: D_FIN, branchId: HQ, positionId: P_ACC, payFrequency: 'MONTHLY', payType: 'SALARY', salaryPerPeriod: '280000.00' });
  const e4 = await mk(4, 'Dwayne', 'Thompson', { departmentId: D_OPS, branchId: MBJ, positionId: P_SUP, payFrequency: 'FORTNIGHTLY', payType: 'SALARY', salaryPerPeriod: '110000.00' });
  const e5 = await mk(5, 'Keisha', 'Brown', { departmentId: D_OPS, branchId: MBJ, positionId: P_OPR, payFrequency: 'WEEKLY', payType: 'HOURLY', hourlyRate: '1150.00' });
  const e6 = await mk(6, 'Omar', 'Clarke', { departmentId: D_OPS, branchId: MBJ, positionId: P_OPR, payFrequency: 'WEEKLY', payType: 'HOURLY', hourlyRate: '1100.00' });
  await mk(7, 'Tanya', 'Edwards', { departmentId: D_SALES, branchId: HQ, positionId: P_REP, payFrequency: 'FORTNIGHTLY', payType: 'SALARY', salaryPerPeriod: '95000.00' });
  await mk(8, 'Ricardo', 'Grant', { departmentId: D_SALES, branchId: MBJ, positionId: P_REP, payFrequency: 'FORTNIGHTLY', payType: 'HOURLY', hourlyRate: '1250.00' });
  await prisma.tenant.update({ where: { id: t }, data: { nextEmployeeSeq: 9 } });
  await prisma.employee.update({ where: { id: e5.id }, data: { supervisorId: e4.id } });
  await prisma.employee.update({ where: { id: e6.id }, data: { supervisorId: e4.id } });

  const pension = await prisma.deductionType.findFirstOrThrow({ where: { tenantId: t, code: 'PENSION' } });
  const travel = await prisma.allowanceType.findFirstOrThrow({ where: { tenantId: t, code: 'TRAVEL' } });
  await prisma.employeeDeduction.create({ data: { tenantId: t, employeeId: e2.id, deductionTypeId: pension.id, amount: new D('16000'), startDate: new Date(Date.UTC(year - 1, 0, 1)) } });
  await prisma.employeeAllowance.create({ data: { tenantId: t, employeeId: e4.id, allowanceTypeId: travel.id, amount: new D('8000'), startDate: new Date(Date.UTC(year - 1, 0, 1)) } });
  for (const [e, last4] of [
    [e1, '0001'],
    [e2, '0002'],
    [e3, '0003'],
    [e4, '0004'],
    [e5, '0005'],
    [e6, '0006'],
  ] as const) {
    await prisma.employeeBankAccount.create({
      data: { tenantId: t, employeeId: e.id, bankName: 'Demo Bank Jamaica', branchCode: '001', accountType: 'SAVINGS', accountNumberEnc: crypto.encrypt(`123456${last4}`), accountLast4: last4, accountHolder: `${e.firstName} ${e.lastName}` },
    });
  }

  // Users & memberships (each privileged demo user is pre-enrolled in MFA with the printed dev secret)
  const member = async (email: string, name: string, role: string, employeeId: string | null, mfa: boolean) => {
    const u = await mkUser(email, name, mfa);
    const m = await prisma.tenantMembership.create({ data: { tenantId: t, userId: u.id, status: 'ACTIVE', employeeId } });
    await prisma.membershipRole.create({ data: { membershipId: m.id, roleId: roles[role] } });
    return u;
  };
  await prisma.tenantMembership.update({ where: { tenantId_userId: { tenantId: t, userId: admin.id } }, data: { employeeId: e1.id } });
  await member('hr@bluemountain.demo', 'Shanice Williams', 'HR_OFFICER', e3.id, false);
  await member('payroll@bluemountain.demo', 'Marcus Reid', 'PAYROLL_OFFICER', e2.id, true);
  await member('finance@bluemountain.demo', 'Finance Approver', 'FINANCE_APPROVER', null, true);
  await member('manager@bluemountain.demo', 'Dwayne Thompson', 'MANAGER', e4.id, false);
  await member('employee@bluemountain.demo', 'Keisha Brown', 'EMPLOYEE', e5.id, false);

  // Some workflow data
  const today = new Date();
  const dayIso = (offset: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset)).toISOString().slice(0, 10);
  for (let i = 1; i <= 5; i++) {
    const wd = dayIso(i);
    const dow = new Date(`${wd}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const e of [e5, e6]) {
      await prisma.timesheet.create({
        data: {
          tenantId: t,
          employeeId: e.id,
          workDate: new Date(`${wd}T00:00:00Z`),
          startTime: '08:00',
          endTime: '16:30',
          breakHours: new D('0.5'),
          regularHours: new D('8'),
          status: 'PENDING',
          activeKey: `${e.id}|${wd}|08:00`,
          submittedByUserId: admin.id,
          delegated: true,
          comments: 'Demo timesheet',
        },
      });
    }
  }
  let leaveDay = dayIso(-14);
  for (let k = 14; k < 21; k++) {
    const d = dayIso(-k);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      leaveDay = d;
      break;
    }
  }
  await prisma.leaveRequest.create({
    data: {
      tenantId: t,
      employeeId: e3.id,
      leaveTypeId: vac.id,
      startDate: new Date(`${leaveDay}T00:00:00Z`),
      endDate: new Date(`${leaveDay}T00:00:00Z`),
      workingDays: new D(1),
      payPercent: new D(100),
      reason: 'Family event (demo)',
      submittedByUserId: admin.id,
      delegated: true,
    },
  });

  // Second demo tenant on the Free plan (shows Free entitlements and tenant isolation)
  const freeAdmin = await mkUser('owner@negrilbeach.demo', 'Paul Morgan', true);
  await prisma.tx((tx) => provisioning.provisionTenant(tx, { legalName: 'Negril Beach Services (DEMO)', displayName: 'Negril Beach Services', adminUserId: freeAdmin.id, email: 'owner@negrilbeach.demo' }), { timeout: 60_000 });

  console.log('\n──────────────── DEMO DATA (development only) ────────────────');
  console.log('Tenant "Blue Mountain Traders" (Professional plan, demo synthetic statutory rules)');
  console.log(`  Password for all demo users: ${DEMO_PASSWORD}`);
  console.log('  admin@bluemountain.demo     Company Administrator  (MFA)');
  console.log('  hr@bluemountain.demo        HR Officer');
  console.log('  payroll@bluemountain.demo   Payroll Officer        (MFA)');
  console.log('  finance@bluemountain.demo   Finance Approver       (MFA)');
  console.log('  manager@bluemountain.demo   Manager/Supervisor');
  console.log('  employee@bluemountain.demo  Employee (self-service)');
  console.log('Tenant "Negril Beach Services" (Free plan): owner@negrilbeach.demo (MFA)');
  console.log(`  Demo TOTP secret for MFA users: ${DEMO_TOTP_SECRET}  (current code: ${authenticator.generate(DEMO_TOTP_SECRET)})`);
  console.log('──────────────────────────────────────────────────────────────\n');
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
