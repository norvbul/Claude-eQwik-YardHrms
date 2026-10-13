import { Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PlatformPermissions as PP } from '@yardhrms/authorization';
import {
  capacitySchema,
  changePlanSchema,
  codeIssueSchema,
  customerSchema,
  paymentDecisionSchema,
  paymentRejectSchema,
  paymentSchema,
  planSchema,
  productSchema,
  renewSchema,
  staffSchema,
  subscriptionCreateSchema,
  subscriptionStateChangeSchema,
} from '@yardhrms/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import { Auth, Permissions, PlatformRoute } from '../common/decorators';
import { CryptoService } from '../common/crypto.service';
import { businessRule, conflict, notFound } from '../common/errors';
import { ZBody, ZQuery } from '../common/zod';
import { APP_CONFIG } from '../config/config';
import { Inject } from '@nestjs/common';
import type { AppConfig } from '../config/config';
import { LicensingCore } from '../licensing/licensing-core.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PlatformService } from './platform.service';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().max(30).optional(),
  search: z.string().max(100).optional(),
  customerId: z.string().optional(),
});

@ApiTags('Qwik Platform — Licence Manager')
@PlatformRoute()
@Controller('platform')
export class PlatformController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly platform: PlatformService,
    private readonly licensing: LicensingCore,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  @Get('dashboard')
  @Permissions(PP.DASHBOARD)
  dashboard() {
    return this.platform.dashboard();
  }

  // Customers (LIC-002)
  @Get('customers')
  @Permissions(PP.CUSTOMERS_READ)
  customers(@ZQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.platform.customers(q);
  }

  @Get('customers/:id')
  @Permissions(PP.CUSTOMERS_READ)
  customer(@Param('id') id: string) {
    return this.platform.customer(id);
  }

  @Post('customers')
  @Permissions(PP.CUSTOMERS_WRITE)
  createCustomer(@Auth() a: AuthContext, @ZBody(customerSchema) body: z.infer<typeof customerSchema>) {
    return this.platform.createCustomer(a, body);
  }

  @Patch('customers/:id')
  @Permissions(PP.CUSTOMERS_WRITE)
  updateCustomer(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(customerSchema.partial()) body: Partial<z.infer<typeof customerSchema>>) {
    return this.platform.updateCustomer(a, id, body);
  }

  /** Tenant lookup for linking customers (metadata only — no HR/payroll data). */
  @Get('tenants')
  @Permissions(PP.CUSTOMERS_READ)
  async tenants(@Query('search') search?: string) {
    return this.prisma.tenant.findMany({
      where: search ? { OR: [{ displayName: { contains: search } }, { legalName: { contains: search } }, { slug: { contains: search } }] } : {},
      select: { id: true, displayName: true, legalName: true, slug: true, status: true, createdAt: true, customers: { select: { id: true, name: true } } },
      take: 50,
      orderBy: { displayName: 'asc' },
    });
  }

  // Catalog (LIC-001)
  @Get('products')
  @Permissions(PP.CUSTOMERS_READ)
  products() {
    return this.platform.products();
  }

  @Post('products')
  @Permissions(PP.CATALOG_MANAGE)
  async createProduct(@Auth() a: AuthContext, @ZBody(productSchema) body: z.infer<typeof productSchema>) {
    const p = await this.prisma.product.create({ data: { ...body, description: body.description ?? null } });
    await this.audit.record({ scope: 'PLATFORM', action: 'platform.product_created', entityType: 'Product', entityId: p.id, after: body, actorUserId: a.user.id });
    return p;
  }

  @Patch('products/:id')
  @Permissions(PP.CATALOG_MANAGE)
  async updateProduct(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(productSchema.partial()) body: Partial<z.infer<typeof productSchema>>) {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) throw notFound('Product');
    const p = await this.prisma.product.update({ where: { id }, data: body });
    await this.audit.record({ scope: 'PLATFORM', action: 'platform.product_updated', entityType: 'Product', entityId: id, before, after: body, actorUserId: a.user.id });
    return p;
  }

  @Get('features')
  @Permissions(PP.CUSTOMERS_READ)
  features() {
    return this.platform.features();
  }

  @Get('plans')
  @Permissions(PP.CUSTOMERS_READ)
  plans() {
    return this.platform.plans();
  }

  @Post('plans')
  @Permissions(PP.CATALOG_MANAGE)
  createPlan(@Auth() a: AuthContext, @ZBody(planSchema) body: z.infer<typeof planSchema>) {
    return this.platform.upsertPlan(a, body);
  }

  @Put('plans/:id')
  @Permissions(PP.CATALOG_MANAGE)
  updatePlan(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(planSchema) body: z.infer<typeof planSchema>) {
    return this.platform.upsertPlan(a, body, id);
  }

  // Manual payments (LIC-003/004)
  @Get('payments')
  @Permissions(PP.PAYMENTS_READ)
  payments(@ZQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.platform.payments(q);
  }

  @Get('payments/:id')
  @Permissions(PP.PAYMENTS_READ)
  payment(@Param('id') id: string) {
    return this.platform.payment(id);
  }

  @Post('payments')
  @Permissions(PP.PAYMENTS_RECORD)
  recordPayment(@Auth() a: AuthContext, @ZBody(paymentSchema) body: z.infer<typeof paymentSchema>) {
    return this.platform.recordPayment(a, body);
  }

  @Post('payments/:id/evidence')
  @Permissions(PP.PAYMENTS_RECORD)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadEvidence(@Auth() a: AuthContext, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    const p = await this.prisma.manualPayment.findUnique({ where: { id } });
    if (!p) throw notFound('Payment');
    const type = this.storage.validateUpload(file, 'document');
    const key = this.storage.key('platform/payments', id, file.originalname);
    await this.storage.put(key, file.buffer, type);
    const ev = await this.prisma.paymentEvidence.create({
      data: { paymentId: id, storageKey: key, fileName: file.originalname.slice(0, 190), contentType: type, sizeBytes: file.size, sha256: this.crypto.sha256(file.buffer), uploadedById: a.user.id },
    });
    await this.audit.record({ scope: 'PLATFORM', action: 'platform.payment_evidence_uploaded', entityType: 'PaymentEvidence', entityId: ev.id, metadata: { paymentId: id, fileName: ev.fileName, sha256: ev.sha256 }, actorUserId: a.user.id });
    return { id: ev.id, fileName: ev.fileName };
  }

  @Get('payments/:id/evidence/:evidenceId')
  @Permissions(PP.PAYMENTS_READ)
  async downloadEvidence(@Auth() a: AuthContext, @Param('id') id: string, @Param('evidenceId') evidenceId: string, @Res({ passthrough: true }) res: Response) {
    const ev = await this.prisma.paymentEvidence.findFirst({ where: { id: evidenceId, paymentId: id } });
    if (!ev) throw notFound('Evidence');
    await this.audit.record({ scope: 'PLATFORM', action: 'platform.payment_evidence_downloaded', entityType: 'PaymentEvidence', entityId: ev.id, actorUserId: a.user.id });
    res.setHeader('Content-Type', ev.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${ev.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    return new StreamableFile(await this.storage.get(ev.storageKey));
  }

  @Post('payments/:id/verify')
  @Permissions(PP.PAYMENTS_VERIFY)
  @HttpCode(200)
  verify(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(paymentDecisionSchema) body: z.infer<typeof paymentDecisionSchema>) {
    return this.platform.transitionPayment(a, id, 'VERIFIED', body.reason);
  }

  @Post('payments/:id/reject')
  @Permissions(PP.PAYMENTS_VERIFY)
  @HttpCode(200)
  reject(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(paymentRejectSchema) body: z.infer<typeof paymentRejectSchema>) {
    return this.platform.transitionPayment(a, id, 'REJECTED', body.reason);
  }

  @Post('payments/:id/reverse')
  @Permissions(PP.PAYMENTS_REVERSE)
  @HttpCode(200)
  reverse(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(paymentRejectSchema) body: z.infer<typeof paymentRejectSchema>) {
    return this.platform.transitionPayment(a, id, 'REVERSED', body.reason);
  }

  // Subscriptions (LIC-005/009/010)
  @Get('subscriptions')
  @Permissions(PP.SUBSCRIPTIONS_READ)
  subscriptions(@ZQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.platform.subscriptions(q);
  }

  @Get('subscriptions/:id')
  @Permissions(PP.SUBSCRIPTIONS_READ)
  subscription(@Param('id') id: string) {
    return this.platform.subscription(id);
  }

  /** AC-03: a paid subscription requires a VERIFIED payment or an authorized, reasoned override. */
  @Post('subscriptions')
  @Permissions(PP.SUBSCRIPTIONS_MANAGE)
  async createSubscription(@Auth() a: AuthContext, @ZBody(subscriptionCreateSchema) body: z.infer<typeof subscriptionCreateSchema>) {
    const sub = await this.prisma.tx(async (tx) => {
      const created = await this.licensing.createPaidSubscription(tx, {
        customerId: body.customerId,
        planId: body.planId,
        paymentId: body.paymentId,
        override: body.override,
        overrideReason: body.overrideReason,
        employeeLimitOverride: body.employeeLimitOverride,
        userLimitOverride: body.userLimitOverride,
        actorUserId: a.user.id,
        canOverride: a.permissions.has(PP.COMMERCIAL_OVERRIDE),
      });
      if (body.applyToTenantDirectly) {
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: body.customerId } });
        if (!customer.tenantId) throw businessRule('Customer is not linked to a registered company; issue an activation code instead');
        await this.licensing.activate(tx, created.id, customer.tenantId, a.user.id, 'DIRECT');
      }
      return created;
    });
    return this.platform.subscription(sub.id);
  }

  @Post('subscriptions/:id/renew')
  @Permissions(PP.SUBSCRIPTIONS_MANAGE)
  @HttpCode(200)
  async renew(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(renewSchema) body: z.infer<typeof renewSchema>) {
    await this.prisma.tx((tx) =>
      this.licensing.renew(tx, id, { paymentId: body.paymentId, months: body.months, override: body.override, overrideReason: body.overrideReason, actorUserId: a.user.id, canOverride: a.permissions.has(PP.COMMERCIAL_OVERRIDE) }),
    );
    return this.platform.subscription(id);
  }

  @Post('subscriptions/:id/change-plan')
  @Permissions(PP.SUBSCRIPTIONS_MANAGE)
  @HttpCode(200)
  async changePlan(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(changePlanSchema) body: z.infer<typeof changePlanSchema>) {
    await this.prisma.tx((tx) => this.licensing.changePlan(tx, id, body.planId, body.reason, a.user.id));
    return this.platform.subscription(id);
  }

  @Post('subscriptions/:id/capacity')
  @Permissions(PP.SUBSCRIPTIONS_MANAGE)
  @HttpCode(200)
  async capacity(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(capacitySchema) body: z.infer<typeof capacitySchema>) {
    await this.prisma.tx((tx) => this.licensing.adjustCapacity(tx, id, body, a.user.id));
    return this.platform.subscription(id);
  }

  @Post('subscriptions/:id/activate')
  @Permissions(PP.SUBSCRIPTIONS_MANAGE)
  @HttpCode(200)
  async activateDirect(@Auth() a: AuthContext, @Param('id') id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id }, include: { customer: true } });
    if (!sub) throw notFound('Subscription');
    if (!sub.customer.tenantId) throw businessRule('Customer is not linked to a registered company; issue an activation code instead');
    await this.prisma.tx((tx) => this.licensing.activate(tx, id, sub.customer.tenantId!, a.user.id, 'DIRECT'));
    return this.platform.subscription(id);
  }

  @Post('subscriptions/:id/suspend')
  @Permissions(PP.SUBSCRIPTIONS_SUSPEND)
  @HttpCode(200)
  async suspend(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(subscriptionStateChangeSchema) body: z.infer<typeof subscriptionStateChangeSchema>) {
    await this.prisma.tx((tx) => this.licensing.setState(tx, id, 'SUSPEND', body.reason, a.user.id));
    return this.platform.subscription(id);
  }

  @Post('subscriptions/:id/revoke')
  @Permissions(PP.SUBSCRIPTIONS_SUSPEND)
  @HttpCode(200)
  async revoke(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(subscriptionStateChangeSchema) body: z.infer<typeof subscriptionStateChangeSchema>) {
    await this.prisma.tx((tx) => this.licensing.setState(tx, id, 'REVOKE', body.reason, a.user.id));
    return this.platform.subscription(id);
  }

  @Post('subscriptions/:id/reinstate')
  @Permissions(PP.SUBSCRIPTIONS_SUSPEND)
  @HttpCode(200)
  async reinstate(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(subscriptionStateChangeSchema) body: z.infer<typeof subscriptionStateChangeSchema>) {
    await this.prisma.tx((tx) => this.licensing.setState(tx, id, 'REINSTATE', body.reason, a.user.id));
    return this.platform.subscription(id);
  }

  @Get('licenses')
  @Permissions(PP.SUBSCRIPTIONS_READ)
  licenses(@ZQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.platform.licenses(q);
  }

  // Activation codes (LIC-006)
  @Get('codes')
  @Permissions(PP.SUBSCRIPTIONS_READ)
  codes(@ZQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.platform.codes(q);
  }

  @Post('codes')
  @Permissions(PP.CODES_ISSUE)
  issueCode(@Auth() a: AuthContext, @ZBody(codeIssueSchema) body: z.infer<typeof codeIssueSchema>) {
    return this.platform.issueCode(a, body.subscriptionId, body.expiresInDays);
  }

  @Post('codes/:id/revoke')
  @Permissions(PP.CODES_REVOKE)
  @HttpCode(200)
  revokeCode(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(subscriptionStateChangeSchema) body: z.infer<typeof subscriptionStateChangeSchema>) {
    return this.platform.revokeCode(a, id, body.reason);
  }

  // Renewals, usage, audit
  @Get('renewals')
  @Permissions(PP.SUBSCRIPTIONS_READ)
  renewals(@Query('days') days?: string) {
    return this.platform.renewals(Math.min(365, Math.max(1, Number(days) || 30)));
  }

  @Post('renewals/sweep')
  @Permissions(PP.SUBSCRIPTIONS_MANAGE)
  @HttpCode(200)
  sweep() {
    return this.licensing.sweepExpirations();
  }

  @Get('usage')
  @Permissions(PP.USAGE_READ)
  usage() {
    return this.platform.usage();
  }

  @Get('audit')
  @Permissions(PP.AUDIT_READ)
  auditLog(@ZQuery(listQuery.extend({ action: z.string().max(80).optional() })) q: any) {
    return this.platform.auditLog(q);
  }

  // Settings — Qwik staff accounts
  @Get('staff')
  @Permissions(PP.STAFF_MANAGE)
  async staff() {
    return this.prisma.user.findMany({
      where: { platformRole: { not: null } },
      select: { id: true, email: true, fullName: true, platformRole: true, status: true, mfaEnabledAt: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('staff')
  @Permissions(PP.STAFF_MANAGE)
  async addStaff(@Auth() a: AuthContext, @ZBody(staffSchema) body: z.infer<typeof staffSchema>) {
    const email = body.email!;
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.platformRole) throw conflict('This person is already Qwik staff');
    user = user
      ? await this.prisma.user.update({ where: { id: user.id }, data: { platformRole: body.platformRole } })
      : await this.prisma.user.create({ data: { email, fullName: body.fullName, platformRole: body.platformRole } });
    const token = this.crypto.randomToken(32);
    await this.prisma.emailToken.create({ data: { userId: user.id, purpose: 'PASSWORD_RESET', tokenHash: this.crypto.hmac(token), expiresAt: new Date(Date.now() + 72 * 3600_000) } });
    const { text, html } = this.mail.layout('Qwik Licence Manager access', ['You have been granted access to the Qwik Licence & Subscription Manager. Set your password, then enrol multi-factor authentication at first sign-in.'], {
      label: 'Set password',
      url: `${this.config.ADMIN_WEB_URL}/reset-password?token=${encodeURIComponent(token)}`,
    });
    await this.mail.send({ to: email, subject: 'Qwik Licence Manager access', template: 'staff_invite', text, html });
    await this.audit.record({ scope: 'PLATFORM', action: 'platform.staff_added', entityType: 'User', entityId: user.id, after: { email, role: body.platformRole }, actorUserId: a.user.id });
    return { id: user.id };
  }

  @Post('staff/:id/disable')
  @Permissions(PP.STAFF_MANAGE)
  @HttpCode(200)
  async disableStaff(@Auth() a: AuthContext, @Param('id') id: string) {
    if (id === a.user.id) throw businessRule('You cannot remove your own platform access');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user?.platformRole) throw notFound('Staff member');
    if (user.platformRole === 'PLATFORM_SUPER_ADMIN') {
      const others = await this.prisma.user.count({ where: { platformRole: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', id: { not: id } } });
      if (!others) throw businessRule('At least one active Platform Super Admin is required');
    }
    await this.prisma.user.update({ where: { id }, data: { platformRole: null } });
    await this.prisma.session.updateMany({ where: { userId: id, kind: 'PLATFORM', revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ scope: 'PLATFORM', action: 'platform.staff_removed', entityType: 'User', entityId: id, actorUserId: a.user.id });
    return { removed: true };
  }

  @Get('settings')
  @Permissions(PP.DASHBOARD)
  settings() {
    return {
      paymentRequiresSeparateVerifier: this.config.PAYMENT_REQUIRE_SEPARATE_VERIFIER,
      mfaEnforcement: this.config.MFA_ENFORCEMENT,
      payrollComplianceCertified: this.config.PAYROLL_COMPLIANCE_CERTIFIED,
      paymentGateway: 'NONE — manual payment verification only (release 1)',
      sessionIdleMinutes: this.config.SESSION_IDLE_MINUTES,
    };
  }
}
