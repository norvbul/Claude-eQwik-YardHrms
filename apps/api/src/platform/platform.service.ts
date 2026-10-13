import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FEATURE_CATALOG, effectiveSubscriptionState, type SubscriptionState } from '@yardhrms/authorization';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import { CryptoService } from '../common/crypto.service';
import { badRequest, businessRule, forbidden, invalidState, notFound } from '../common/errors';
import { decOrNull, isoDay, paginate, toDate } from '../common/util';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

const D = Prisma.Decimal;

/**
 * Qwik Licence & Subscription Manager services (PRD §7). Platform staff manage commercial metadata
 * only; no tenant HR/payroll records are exposed here (PRD §8.3).
 */
@Injectable()
export class PlatformService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private pa(auth: AuthContext, input: Parameters<AuditService['record']>[0]) {
    return this.audit.record({ scope: 'PLATFORM', actorUserId: auth.user.id, actorEmail: auth.user.email, ...input });
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  async dashboard() {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86_400_000);
    const subs = await this.prisma.subscription.findMany({
      where: { status: { notIn: ['SUPERSEDED', 'PENDING_ACTIVATION'] }, tenantId: { not: null } },
      include: { plan: true },
    });
    const effective = subs.map((s) => ({ ...s, eff: effectiveSubscriptionState({ status: s.status as SubscriptionState, periodEnd: s.periodEnd, graceEnd: s.graceEnd }, now) }));
    const current = effective.filter((s) => s.tenantId);
    const [customers, pendingPayments, verifiedByCurrency, tenants] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.manualPayment.count({ where: { status: 'PENDING' } }),
      this.prisma.manualPayment.groupBy({ by: ['currency'], where: { status: 'VERIFIED' }, _sum: { amount: true }, _count: true }),
      this.prisma.tenant.findMany({ where: { currentSubscriptionId: { not: null } }, select: { id: true, currentSubscriptionId: true } }),
    ]);
    const currentIds = new Set(tenants.map((t) => t.currentSubscriptionId));
    const live = current.filter((s) => currentIds.has(s.id));
    const planDist = new Map<string, number>();
    for (const s of live) planDist.set(s.plan.name, (planDist.get(s.plan.name) ?? 0) + 1);
    // Capacity utilization across live tenants
    let empUsed = 0,
      empCap = 0,
      userUsed = 0,
      userCap = 0;
    for (const t of tenants) {
      const sum = await this.entitlements.summary(t.id);
      empUsed += sum.activeEmployees;
      empCap += sum.employeeLimit;
      userUsed += sum.activeUsers;
      userCap += sum.userLimit;
    }
    return {
      totals: {
        customers,
        tenants: tenants.length,
        activePaid: live.filter((s) => !s.plan.isFree && (s.eff === 'ACTIVE' || s.eff === 'GRACE')).length,
        free: live.filter((s) => s.eff === 'FREE').length,
        grace: live.filter((s) => s.eff === 'GRACE').length,
        expired: live.filter((s) => s.eff === 'EXPIRED').length,
        suspended: live.filter((s) => s.eff === 'SUSPENDED' || s.eff === 'REVOKED').length,
        upcomingRenewals: live.filter((s) => s.periodEnd && s.periodEnd >= now && s.periodEnd <= in30).length,
        pendingPayments,
      },
      verifiedRevenueByCurrency: verifiedByCurrency.map((v) => ({ currency: v.currency, amount: (v._sum.amount ?? new D(0)).toFixed(2), payments: v._count })),
      planDistribution: [...planDist.entries()].map(([name, value]) => ({ name, value })),
      capacity: { employeesUsed: empUsed, employeesLicensed: empCap, usersUsed: userUsed, usersLicensed: userCap },
    };
  }

  // ── Customers ─────────────────────────────────────────────────────────────
  async customers(q: { page: number; pageSize: number; search?: string }) {
    const where: Prisma.CustomerWhereInput = q.search ? { OR: [{ name: { contains: q.search } }, { email: { contains: q.search } }, { contactName: { contains: q.search } }] } : {};
    const [total, rows] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        include: { tenant: { select: { id: true, displayName: true, slug: true, status: true, currentSubscription: { include: { plan: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return paginate(
      rows.map((c) => {
        const sub = c.tenant?.currentSubscription;
        return {
          ...c,
          tenant: c.tenant ? { id: c.tenant.id, displayName: c.tenant.displayName, slug: c.tenant.slug, status: c.tenant.status } : null,
          currentPlan: sub?.plan.name ?? null,
          subscriptionStatus: sub ? effectiveSubscriptionState({ status: sub.status as SubscriptionState, periodEnd: sub.periodEnd, graceEnd: sub.graceEnd }) : null,
          periodEnd: sub?.periodEnd ?? null,
        };
      }),
      total,
      q.page,
      q.pageSize,
    );
  }

  async customer(id: string) {
    const c = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, displayName: true, legalName: true, slug: true, status: true, createdAt: true, currentSubscriptionId: true } },
        subscriptions: { include: { plan: true, license: true }, orderBy: { createdAt: 'desc' } },
        payments: { orderBy: { paymentDate: 'desc' } },
        codes: { orderBy: { createdAt: 'desc' }, select: { id: true, codeHint: true, status: true, expiresAt: true, redeemedAt: true, subscriptionId: true, createdAt: true } },
      },
    });
    if (!c) throw notFound('Customer');
    const usage = c.tenant ? await this.entitlements.summary(c.tenant.id) : null;
    const events = await this.prisma.subscriptionEvent.findMany({ where: { subscriptionId: { in: c.subscriptions.map((s) => s.id) } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return {
      ...c,
      usage,
      subscriptions: c.subscriptions.map((s) => ({ ...s, effectiveStatus: effectiveSubscriptionState({ status: s.status as SubscriptionState, periodEnd: s.periodEnd, graceEnd: s.graceEnd }), isCurrent: s.id === c.tenant?.currentSubscriptionId })),
      payments: c.payments.map((p) => ({ ...p, paymentDate: isoDay(p.paymentDate), periodStart: isoDay(p.periodStart), periodEnd: isoDay(p.periodEnd) })),
      events,
    };
  }

  async createCustomer(auth: AuthContext, input: any) {
    if (input.tenantId) await this.assertTenantLinkable(input.tenantId);
    const c = await this.prisma.customer.create({ data: { ...input, createdById: auth.user.id } });
    await this.pa(auth, { action: 'platform.customer_created', entityType: 'Customer', entityId: c.id, after: input });
    return c;
  }

  async updateCustomer(auth: AuthContext, id: string, input: any) {
    const before = await this.prisma.customer.findUnique({ where: { id } });
    if (!before) throw notFound('Customer');
    if (input.tenantId && input.tenantId !== before.tenantId) await this.assertTenantLinkable(input.tenantId);
    const c = await this.prisma.customer.update({ where: { id }, data: input });
    await this.pa(auth, { action: 'platform.customer_updated', entityType: 'Customer', entityId: id, before, after: input });
    return c;
  }

  private async assertTenantLinkable(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw badRequest('Tenant not found');
    const linked = await this.prisma.customer.findUnique({ where: { tenantId } });
    if (linked) throw businessRule(`Tenant is already linked to customer "${linked.name}"`);
  }

  // ── Catalog ───────────────────────────────────────────────────────────────
  products() {
    return this.prisma.product.findMany({ include: { _count: { select: { plans: true } } }, orderBy: { name: 'asc' } });
  }

  features() {
    return this.prisma.feature.findMany({ orderBy: { code: 'asc' } });
  }

  async plans() {
    const rows = await this.prisma.plan.findMany({ include: { features: true, product: true, _count: { select: { subscriptions: true } } }, orderBy: [{ isFree: 'desc' }, { employeeLimit: 'asc' }] });
    return rows.map((p) => ({ ...p, price: p.price?.toString() ?? null, features: p.features.filter((f) => f.enabled).map((f) => f.featureCode) }));
  }

  async upsertPlan(auth: AuthContext, input: any, id?: string) {
    const valid = new Set<string>(FEATURE_CATALOG.map((f) => f.code));
    const bad = (input.features as string[]).filter((f) => !valid.has(f));
    if (bad.length) throw badRequest(`Unknown features: ${bad.join(', ')}`);
    if (!input.isFree && input.durationMonths == null) throw badRequest('Paid plans need a subscription duration');
    const product = await this.prisma.product.findUnique({ where: { id: input.productId } });
    if (!product) throw badRequest('Product not found');
    const data = {
      productId: input.productId,
      code: input.code,
      name: input.name,
      isFree: input.isFree,
      price: decOrNull(input.price),
      currency: input.currency,
      durationMonths: input.isFree ? null : input.durationMonths,
      employeeLimit: input.employeeLimit,
      userLimit: input.userLimit,
      gracePeriodDays: input.gracePeriodDays,
      status: input.status,
    };
    const plan = await this.prisma.tx(async (tx) => {
      const before = id ? await tx.plan.findUnique({ where: { id }, include: { features: true } }) : null;
      if (id && !before) throw notFound('Plan');
      const p = id ? await tx.plan.update({ where: { id }, data: { ...data, version: { increment: 1 } } }) : await tx.plan.create({ data });
      await tx.planFeature.deleteMany({ where: { planId: p.id } });
      await tx.planFeature.createMany({ data: (input.features as string[]).map((f) => ({ planId: p.id, featureCode: f, enabled: true })) });
      await this.audit.record({ scope: 'PLATFORM', action: id ? 'platform.plan_updated' : 'platform.plan_created', entityType: 'Plan', entityId: p.id, before: before ?? undefined, after: input, actorUserId: auth.user.id }, tx);
      return p;
    });
    return plan;
  }

  // ── Manual payments (LIC-003/004) ─────────────────────────────────────────
  async payments(q: { page: number; pageSize: number; status?: string; customerId?: string; search?: string }) {
    const where: Prisma.ManualPaymentWhereInput = {};
    if (q.status) where.status = q.status as any;
    if (q.customerId) where.customerId = q.customerId;
    if (q.search) where.OR = [{ reference: { contains: q.search } }, { invoiceNumber: { contains: q.search } }, { customer: { name: { contains: q.search } } }];
    const [total, rows] = await Promise.all([
      this.prisma.manualPayment.count({ where }),
      this.prisma.manualPayment.findMany({ where, include: { customer: { select: { id: true, name: true } }, _count: { select: { evidence: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return paginate(
      rows.map((p) => ({ ...p, amount: p.amount.toFixed(2), paymentDate: isoDay(p.paymentDate), periodStart: isoDay(p.periodStart), periodEnd: isoDay(p.periodEnd) })),
      total,
      q.page,
      q.pageSize,
    );
  }

  async payment(id: string) {
    const p = await this.prisma.manualPayment.findUnique({
      where: { id },
      include: { customer: true, history: { orderBy: { createdAt: 'asc' } }, evidence: { select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true, sha256: true } } },
    });
    if (!p) throw notFound('Payment');
    return { ...p, amount: p.amount.toFixed(2), paymentDate: isoDay(p.paymentDate), periodStart: isoDay(p.periodStart), periodEnd: isoDay(p.periodEnd) };
  }

  async recordPayment(auth: AuthContext, input: any) {
    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw badRequest('Customer not found');
    if (input.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: input.planId } });
      if (!plan) throw badRequest('Plan not found');
    }
    const p = await this.prisma.tx(async (tx) => {
      const created = await tx.manualPayment.create({
        data: {
          customerId: customer.id,
          tenantId: customer.tenantId,
          planId: input.planId ?? null,
          invoiceNumber: input.invoiceNumber ?? null,
          reference: input.reference,
          paymentDate: toDate(input.paymentDate),
          amount: new D(input.amount),
          currency: input.currency,
          method: input.method,
          periodStart: toDate(input.periodStart),
          periodEnd: toDate(input.periodEnd),
          notes: input.notes ?? null,
          recordedById: auth.user.id,
        },
      });
      await tx.manualPaymentEvent.create({ data: { paymentId: created.id, toStatus: 'PENDING', actorId: auth.user.id, actorEmail: auth.user.email, reason: 'Recorded' } });
      await this.audit.record({ scope: 'PLATFORM', action: 'platform.payment_recorded', entityType: 'ManualPayment', entityId: created.id, after: input, actorUserId: auth.user.id }, tx);
      return created;
    });
    return this.payment(p.id);
  }

  /** LIC-004: state machine PENDING→VERIFIED|REJECTED; VERIFIED→REVERSED. Reason/actor/time retained. */
  async transitionPayment(auth: AuthContext, id: string, to: 'VERIFIED' | 'REJECTED' | 'REVERSED', reason?: string | null) {
    await this.prisma.tx(async (tx) => {
      const p = await tx.manualPayment.findUnique({ where: { id } });
      if (!p) throw notFound('Payment');
      const allowed: Record<string, string[]> = { PENDING: ['VERIFIED', 'REJECTED'], VERIFIED: ['REVERSED'] };
      if (!allowed[p.status]?.includes(to)) throw invalidState(`A ${p.status} payment cannot become ${to}`);
      if (to === 'VERIFIED' && this.config.PAYMENT_REQUIRE_SEPARATE_VERIFIER && p.recordedById === auth.user.id) {
        throw forbidden('Separation of duties: a different Qwik officer must verify this payment');
      }
      if ((to === 'REVERSED' || to === 'REJECTED') && !reason) throw badRequest('A reason is required');
      const res = await tx.manualPayment.updateMany({
        where: { id, status: p.status },
        data: { status: to, ...(to === 'VERIFIED' ? { verifiedById: auth.user.id, verifiedAt: new Date() } : {}) },
      });
      if (res.count !== 1) throw invalidState('Payment changed concurrently');
      await tx.manualPaymentEvent.create({ data: { paymentId: id, fromStatus: p.status, toStatus: to, actorId: auth.user.id, actorEmail: auth.user.email, reason: reason ?? null } });
      if (to === 'REVERSED' && p.subscriptionId) {
        await tx.subscriptionEvent.create({
          data: { subscriptionId: p.subscriptionId, tenantId: p.tenantId, type: 'PAYMENT_REVERSED', actorUserId: auth.user.id, reason, data: { paymentId: p.id, amount: p.amount.toFixed(2) } },
        });
      }
      await this.audit.record({ scope: 'PLATFORM', action: `platform.payment_${to.toLowerCase()}`, entityType: 'ManualPayment', entityId: id, before: { status: p.status }, after: { status: to }, reason, actorUserId: auth.user.id }, tx);
    });
    return this.payment(id);
  }

  // ── Subscriptions & licences ─────────────────────────────────────────────
  async subscriptions(q: { page: number; pageSize: number; status?: string; search?: string }) {
    const where: Prisma.SubscriptionWhereInput = {};
    if (q.status) where.status = q.status as any;
    if (q.search) where.customer = { name: { contains: q.search } };
    const [total, rows] = await Promise.all([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        include: { plan: true, customer: { select: { id: true, name: true } }, tenant: { select: { id: true, displayName: true } }, license: true },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return paginate(
      rows.map((s) => ({ ...s, effectiveStatus: effectiveSubscriptionState({ status: s.status as SubscriptionState, periodEnd: s.periodEnd, graceEnd: s.graceEnd }), plan: { id: s.plan.id, code: s.plan.code, name: s.plan.name, isFree: s.plan.isFree } })),
      total,
      q.page,
      q.pageSize,
    );
  }

  async subscription(id: string) {
    const s = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        plan: true,
        customer: true,
        tenant: { select: { id: true, displayName: true, currentSubscriptionId: true } },
        license: true,
        events: { orderBy: { createdAt: 'desc' } },
        payments: { select: { id: true, reference: true, amount: true, currency: true, consumedFor: true, consumedAt: true, status: true } },
        codes: { select: { id: true, codeHint: true, status: true, expiresAt: true, redeemedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!s) throw notFound('Subscription');
    const usage = s.tenantId ? await this.entitlements.summary(s.tenantId) : null;
    return { ...s, effectiveStatus: effectiveSubscriptionState({ status: s.status as SubscriptionState, periodEnd: s.periodEnd, graceEnd: s.graceEnd }), usage, isCurrent: s.tenant?.currentSubscriptionId === s.id };
  }

  async licenses(q: { page: number; pageSize: number; status?: string }) {
    const where: Prisma.LicenseWhereInput = q.status ? { status: q.status as any } : {};
    const [total, rows] = await Promise.all([
      this.prisma.license.count({ where }),
      this.prisma.license.findMany({ where, include: { subscription: { include: { customer: { select: { name: true } }, tenant: { select: { displayName: true } } } } }, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return paginate(rows, total, q.page, q.pageSize);
  }

  // ── Activation codes (LIC-006) ────────────────────────────────────────────
  async issueCode(auth: AuthContext, subscriptionId: string, expiresInDays: number) {
    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: { include: { product: true } } } });
    if (!sub) throw notFound('Subscription');
    if (sub.status !== 'PENDING_ACTIVATION') throw invalidState('Codes can only be issued for subscriptions awaiting activation');
    const outstanding = await this.prisma.activationCode.count({ where: { subscriptionId, status: 'ISSUED', expiresAt: { gt: new Date() } } });
    if (outstanding) throw businessRule('An unredeemed code already exists for this subscription. Revoke it before issuing another.');
    const raw = this.crypto.activationCode();
    const code = await this.prisma.activationCode.create({
      data: {
        codeHash: this.crypto.hmac(this.crypto.normalizeActivationCode(raw)),
        codeHint: `${raw.slice(0, 9)}…${raw.slice(-4)}`,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        planId: sub.planId,
        productCode: sub.plan.product.code,
        expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
        issuedById: auth.user.id,
      },
    });
    await this.pa(auth, { action: 'platform.code_issued', entityType: 'ActivationCode', entityId: code.id, after: { subscriptionId, hint: code.codeHint, expiresAt: code.expiresAt } });
    // The raw code is returned exactly once and never stored.
    return { id: code.id, code: raw, hint: code.codeHint, expiresAt: code.expiresAt };
  }

  async revokeCode(auth: AuthContext, id: string, reason: string) {
    const res = await this.prisma.activationCode.updateMany({ where: { id, status: 'ISSUED' }, data: { status: 'REVOKED', revokedAt: new Date() } });
    if (res.count !== 1) throw invalidState('Only unredeemed codes can be revoked');
    await this.pa(auth, { action: 'platform.code_revoked', entityType: 'ActivationCode', entityId: id, reason });
    return { revoked: true };
  }

  async codes(q: { page: number; pageSize: number; status?: string }) {
    const where: Prisma.ActivationCodeWhereInput = q.status ? { status: q.status as any } : {};
    const [total, rows] = await Promise.all([
      this.prisma.activationCode.count({ where }),
      this.prisma.activationCode.findMany({
        where,
        select: { id: true, codeHint: true, status: true, expiresAt: true, redeemedAt: true, redeemedTenantId: true, createdAt: true, productCode: true, subscriptionId: true, customer: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return paginate(rows, total, q.page, q.pageSize);
  }

  // ── Renewals & usage ─────────────────────────────────────────────────────
  async renewals(days: number) {
    const now = new Date();
    const horizon = new Date(now.getTime() + days * 86_400_000);
    const rows = await this.prisma.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'GRACE', 'EXPIRED'] }, periodEnd: { lte: horizon }, tenantId: { not: null } },
      include: { plan: true, customer: { select: { id: true, name: true, email: true, phone: true } }, tenant: { select: { displayName: true, currentSubscriptionId: true } } },
      orderBy: { periodEnd: 'asc' },
    });
    return rows
      .filter((s) => s.tenant?.currentSubscriptionId === s.id)
      .map((s) => ({
        id: s.id,
        customer: s.customer,
        tenant: s.tenant?.displayName,
        plan: s.plan.name,
        periodEnd: s.periodEnd,
        graceEnd: s.graceEnd,
        status: effectiveSubscriptionState({ status: s.status as SubscriptionState, periodEnd: s.periodEnd, graceEnd: s.graceEnd }, now),
        daysRemaining: s.periodEnd ? Math.ceil((s.periodEnd.getTime() - now.getTime()) / 86_400_000) : null,
      }));
  }

  async usage() {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true, displayName: true, status: true, createdAt: true }, orderBy: { displayName: 'asc' } });
    const out = [];
    for (const t of tenants) {
      const s = await this.entitlements.summary(t.id);
      out.push({ tenantId: t.id, tenant: t.displayName, tenantStatus: t.status, plan: s.planName, status: s.status, employees: s.activeEmployees, employeeLimit: s.employeeLimit, users: s.activeUsers, userLimit: s.userLimit, periodEnd: s.periodEnd });
    }
    return out;
  }

  async auditLog(q: { page: number; pageSize: number; action?: string }) {
    // Platform staff see platform events and subscription/licence events only — never tenant HR/payroll audit detail.
    const where: Prisma.AuditEventWhereInput = {
      AND: [{ OR: [{ scope: 'PLATFORM' }, { action: { startsWith: 'subscription.' } }, { action: 'tenant.registered' }] }, q.action ? { action: { contains: q.action } } : {}],
    };
    const [total, rows] = await Promise.all([this.prisma.auditEvent.count({ where }), this.prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })]);
    return paginate(rows, total, q.page, q.pageSize);
  }
}
