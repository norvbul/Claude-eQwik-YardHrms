import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Plan, type Subscription } from '@prisma/client';
import { addMonths } from '@yardhrms/payroll-engine';
import { ErrorCodes } from '@yardhrms/types';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AppError, businessRule, invalidState, notFound } from '../common/errors';
import { PrismaService, Tx } from '../prisma/prisma.service';

type PlanWithFeatures = Plan & { features: { featureCode: string; enabled: boolean }[] };

/**
 * Core subscription/licensing state machine shared by the tenant HRMS and the Qwik Licence Manager.
 * All mutations run inside caller-provided transactions and write append-only subscription events
 * plus audit events (LIC-012).
 */
@Injectable()
export class LicensingCore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  private featuresOf(plan: PlanWithFeatures): string[] {
    return plan.features.filter((f) => f.enabled).map((f) => f.featureCode).sort();
  }

  private async planWithFeatures(tx: Tx, planId: string): Promise<PlanWithFeatures> {
    const plan = await tx.plan.findUnique({ where: { id: planId }, include: { features: true } });
    if (!plan) throw notFound('Plan');
    return plan;
  }

  private licenseKey(): string {
    return `LIC-${this.crypto.randomHex(6).toUpperCase()}`;
  }

  async event(
    tx: Tx,
    sub: Pick<Subscription, 'id' | 'tenantId'>,
    type: string,
    opts: { from?: string | null; to?: string | null; paymentId?: string | null; actorUserId?: string | null; reason?: string | null; data?: unknown } = {},
  ) {
    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: sub.id,
        tenantId: sub.tenantId,
        type,
        fromStatus: opts.from ?? null,
        toStatus: opts.to ?? null,
        paymentId: opts.paymentId ?? null,
        actorUserId: opts.actorUserId ?? null,
        reason: opts.reason ?? null,
        data: (opts.data as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  /** LIC-007: Free plans provision centrally without codes or payments; one active Free entitlement per tenant. */
  async startFree(tx: Tx, tenantId: string, customerId: string, actorUserId: string | null) {
    const existingFree = await tx.subscription.findFirst({ where: { tenantId, status: 'FREE' } });
    if (existingFree) throw invalidState('This organization already has an active Free subscription');
    const plan = await tx.plan.findFirst({ where: { isFree: true, status: 'ACTIVE' }, include: { features: true }, orderBy: { createdAt: 'asc' } });
    if (!plan) throw new AppError(ErrorCodes.INTERNAL, 'Free plan is not configured. Ask Qwik support to seed plans.', HttpStatus.SERVICE_UNAVAILABLE);
    const now = new Date();
    const sub = await tx.subscription.create({
      data: { customerId, tenantId, planId: plan.id, status: 'FREE', source: 'FREE_SIGNUP', periodStart: now, createdById: actorUserId },
    });
    await tx.license.create({
      data: {
        licenseKey: this.licenseKey(),
        subscriptionId: sub.id,
        tenantId,
        status: 'ACTIVE',
        planCode: plan.code,
        planName: plan.name,
        employeeLimit: plan.employeeLimit,
        userLimit: plan.userLimit,
        features: this.featuresOf(plan),
        activatedAt: now,
      },
    });
    await this.makeCurrent(tx, tenantId, sub.id, actorUserId);
    await this.event(tx, sub, 'FREE_STARTED', { to: 'FREE', actorUserId });
    await this.audit.record({ tenantId, action: 'subscription.free_started', entityType: 'Subscription', entityId: sub.id, after: { plan: plan.code }, actorUserId }, tx);
    return sub;
  }

  /** Points the tenant at a new current subscription and supersedes the previous one. */
  private async makeCurrent(tx: Tx, tenantId: string, subscriptionId: string, actorUserId: string | null) {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { currentSubscriptionId: true } });
    const prevId = tenant?.currentSubscriptionId;
    if (prevId && prevId !== subscriptionId) {
      const prev = await tx.subscription.update({ where: { id: prevId }, data: { status: 'SUPERSEDED' } });
      await tx.license.updateMany({ where: { subscriptionId: prevId }, data: { status: 'INACTIVE' } });
      await this.event(tx, prev, 'SUPERSEDED', { to: 'SUPERSEDED', actorUserId, data: { by: subscriptionId } });
    }
    await tx.tenant.update({ where: { id: tenantId }, data: { currentSubscriptionId: subscriptionId } });
  }

  /**
   * Consumes a VERIFIED, not-yet-consumed payment exactly once (prevents double-spend). The conditional
   * update is atomic; the unique paymentId on subscription_events is a second guard.
   */
  async consumePayment(tx: Tx, paymentId: string, customerId: string, subscriptionId: string, purpose: 'ACTIVATION' | 'RENEWAL') {
    const payment = await tx.manualPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw notFound('Payment');
    if (payment.customerId !== customerId) throw businessRule('The payment belongs to a different customer');
    if (payment.status !== 'VERIFIED') throw businessRule('Only VERIFIED payments can fund a subscription. Verify the payment first.', { status: payment.status });
    const res = await tx.manualPayment.updateMany({
      where: { id: paymentId, status: 'VERIFIED', consumedAt: null },
      data: { consumedAt: new Date(), consumedFor: purpose, subscriptionId },
    });
    if (res.count !== 1) throw invalidState('This payment has already been applied to a subscription');
    return payment;
  }

  async createPaidSubscription(
    tx: Tx,
    input: {
      customerId: string;
      planId: string;
      paymentId?: string | null;
      override?: boolean;
      overrideReason?: string | null;
      employeeLimitOverride?: number | null;
      userLimitOverride?: number | null;
      actorUserId: string;
      canOverride: boolean;
    },
  ) {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw notFound('Customer');
    const plan = await this.planWithFeatures(tx, input.planId);
    if (plan.isFree) throw businessRule('Free subscriptions are provisioned automatically at registration');
    if (plan.status !== 'ACTIVE') throw businessRule('This plan is retired');
    if (!input.paymentId) {
      if (!input.override || !input.overrideReason) throw businessRule('A verified payment is required (AC-03)');
      if (!input.canOverride) throw new AppError(ErrorCodes.FORBIDDEN, 'Commercial overrides require the platform override permission', 403);
    }
    const sub = await tx.subscription.create({
      data: {
        customerId: customer.id,
        planId: plan.id,
        status: 'PENDING_ACTIVATION',
        source: input.paymentId ? 'PAYMENT' : 'OVERRIDE',
        pendingMonths: plan.durationMonths ?? 12,
        employeeLimitOverride: input.employeeLimitOverride ?? null,
        userLimitOverride: input.userLimitOverride ?? null,
        overrideReason: input.paymentId ? null : input.overrideReason,
        createdById: input.actorUserId,
      },
    });
    await tx.license.create({
      data: {
        licenseKey: this.licenseKey(),
        subscriptionId: sub.id,
        status: 'INACTIVE',
        planCode: plan.code,
        planName: plan.name,
        employeeLimit: input.employeeLimitOverride ?? plan.employeeLimit,
        userLimit: input.userLimitOverride ?? plan.userLimit,
        features: this.featuresOf(plan),
      },
    });
    if (input.paymentId) await this.consumePayment(tx, input.paymentId, customer.id, sub.id, 'ACTIVATION');
    await this.event(tx, sub, input.paymentId ? 'CREATED_FROM_PAYMENT' : 'CREATED_BY_OVERRIDE', {
      to: 'PENDING_ACTIVATION',
      paymentId: input.paymentId ?? null,
      actorUserId: input.actorUserId,
      reason: input.overrideReason ?? null,
      data: { plan: plan.code },
    });
    await this.audit.record(
      {
        scope: 'PLATFORM',
        action: input.paymentId ? 'subscription.created' : 'subscription.created_override',
        entityType: 'Subscription',
        entityId: sub.id,
        after: { customerId: customer.id, plan: plan.code, paymentId: input.paymentId ?? null },
        reason: input.overrideReason ?? null,
        actorUserId: input.actorUserId,
      },
      tx,
    );
    return sub;
  }

  /** Activates a PENDING_ACTIVATION subscription for a tenant (via code redemption or direct apply). */
  async activate(tx: Tx, subscriptionId: string, tenantId: string, actorUserId: string, via: 'CODE' | 'DIRECT') {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: { include: { features: true } }, customer: true } });
    if (!sub) throw notFound('Subscription');
    if (sub.status !== 'PENDING_ACTIVATION') throw invalidState('Subscription is not awaiting activation', { status: sub.status });
    if (sub.customer.tenantId && sub.customer.tenantId !== tenantId) throw businessRule('This subscription is bound to a different organization');
    const otherCustomer = await tx.customer.findFirst({ where: { tenantId, id: { not: sub.customerId } } });
    if (otherCustomer) {
      // The tenant registered (Free) before Qwik recorded its customer: link subscription to the tenant's own customer record.
      await tx.subscription.update({ where: { id: sub.id }, data: { customerId: otherCustomer.id } });
    } else if (!sub.customer.tenantId) {
      await tx.customer.update({ where: { id: sub.customerId }, data: { tenantId } });
    }
    const now = new Date();
    const months = sub.pendingMonths ?? sub.plan.durationMonths ?? 12;
    const periodEnd = addMonths(now, months);
    const graceEnd = new Date(periodEnd.getTime() + sub.plan.gracePeriodDays * 86_400_000);
    const updated = await tx.subscription.update({
      where: { id: sub.id },
      data: { tenantId, status: 'ACTIVE', periodStart: now, periodEnd, graceEnd, pendingMonths: null },
    });
    await tx.license.update({ where: { subscriptionId: sub.id }, data: { tenantId, status: 'ACTIVE', activatedAt: now } });
    await this.makeCurrent(tx, tenantId, sub.id, actorUserId);
    await this.event(tx, updated, via === 'CODE' ? 'ACTIVATED_BY_CODE' : 'ACTIVATED_DIRECT', { from: 'PENDING_ACTIVATION', to: 'ACTIVE', actorUserId, data: { periodEnd } });
    await this.audit.record(
      { tenantId, action: via === 'CODE' ? 'subscription.activated_by_code' : 'subscription.activated', entityType: 'Subscription', entityId: sub.id, after: { plan: sub.plan.code, periodEnd }, actorUserId },
      tx,
    );
    return updated;
  }

  /**
   * One-time activation code redemption (LIC-006, AC-04, AC-05). The code row is locked FOR UPDATE and
   * transitioned with a conditional update, so concurrent redemptions cannot both succeed.
   */
  async redeemCode(rawCode: string, tenantId: string, userId: string) {
    const normalized = this.crypto.normalizeActivationCode(rawCode);
    const codeHash = this.crypto.hmac(normalized);
    return this.prisma.tx(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM activation_codes WHERE code_hash = ${codeHash} FOR UPDATE`;
      const reject = async (reason: string, codeId?: string) => {
        await this.audit.record({ tenantId, action: 'subscription.code_redeem_rejected', entityType: 'ActivationCode', entityId: codeId ?? null, reason, actorUserId: userId });
        return businessRule(reason);
      };
      if (!rows.length) throw await reject('Activation code is not valid');
      const code = await tx.activationCode.findUniqueOrThrow({ where: { id: rows[0].id }, include: { customer: true } });
      if (code.status === 'REDEEMED') throw await reject('This activation code has already been used', code.id);
      if (code.status === 'REVOKED') throw await reject('This activation code has been revoked', code.id);
      if (code.status === 'EXPIRED' || code.expiresAt.getTime() < Date.now()) {
        if (code.status === 'ISSUED') await tx.activationCode.update({ where: { id: code.id }, data: { status: 'EXPIRED' } });
        throw await reject('This activation code has expired. Contact Qwik Business Solutions for a new code.', code.id);
      }
      if (code.customer.tenantId && code.customer.tenantId !== tenantId) throw await reject('This activation code was issued to a different organization', code.id);
      const claimed = await tx.activationCode.updateMany({
        where: { id: code.id, status: 'ISSUED' },
        data: { status: 'REDEEMED', redeemedAt: new Date(), redeemedTenantId: tenantId, redeemedByUserId: userId },
      });
      if (claimed.count !== 1) throw businessRule('This activation code has already been used');
      const sub = await this.activate(tx, code.subscriptionId, tenantId, userId, 'CODE');
      await this.audit.record({ tenantId, action: 'subscription.code_redeemed', entityType: 'ActivationCode', entityId: code.id, after: { subscriptionId: sub.id, hint: code.codeHint }, actorUserId: userId }, tx);
      return sub;
    });
  }

  /** LIC-009 / AC-14: renewal extends the existing subscription without a new activation code. */
  async renew(tx: Tx, subscriptionId: string, input: { paymentId?: string | null; months?: number; override?: boolean; overrideReason?: string | null; actorUserId: string; canOverride: boolean }) {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
    if (!sub) throw notFound('Subscription');
    if (sub.plan.isFree) throw businessRule('Free subscriptions do not renew; create a paid subscription instead');
    if (!['ACTIVE', 'GRACE', 'EXPIRED'].includes(sub.status)) throw invalidState(`A ${sub.status} subscription cannot be renewed`, { status: sub.status });
    if (!input.paymentId) {
      if (!input.override || !input.overrideReason) throw businessRule('A verified payment is required to renew');
      if (!input.canOverride) throw new AppError(ErrorCodes.FORBIDDEN, 'Commercial overrides require the platform override permission', 403);
    }
    if (input.paymentId) await this.consumePayment(tx, input.paymentId, sub.customerId, sub.id, 'RENEWAL');
    const months = input.months ?? sub.plan.durationMonths ?? 12;
    const now = new Date();
    const base = sub.periodEnd && sub.periodEnd > now ? sub.periodEnd : now;
    const periodEnd = addMonths(base, months);
    const graceEnd = new Date(periodEnd.getTime() + sub.plan.gracePeriodDays * 86_400_000);
    const updated = await tx.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', periodEnd, graceEnd } });
    await tx.license.updateMany({ where: { subscriptionId: sub.id }, data: { status: 'ACTIVE' } });
    await this.event(tx, updated, 'RENEWED', {
      from: sub.status,
      to: 'ACTIVE',
      paymentId: input.paymentId ?? null,
      actorUserId: input.actorUserId,
      reason: input.overrideReason ?? null,
      data: { previousEnd: sub.periodEnd, newEnd: periodEnd, months },
    });
    await this.audit.record(
      { tenantId: sub.tenantId, scope: 'PLATFORM', action: 'subscription.renewed', entityType: 'Subscription', entityId: sub.id, before: { periodEnd: sub.periodEnd }, after: { periodEnd }, actorUserId: input.actorUserId, reason: input.overrideReason ?? null },
      tx,
    );
    return updated;
  }

  async changePlan(tx: Tx, subscriptionId: string, planId: string, reason: string, actorUserId: string) {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
    if (!sub) throw notFound('Subscription');
    if (['REVOKED', 'SUPERSEDED'].includes(sub.status)) throw invalidState('Cannot change the plan of a revoked or superseded subscription');
    const plan = await this.planWithFeatures(tx, planId);
    if (plan.isFree !== sub.plan.isFree) throw businessRule('Switching between Free and paid uses a new paid subscription (payment + activation), not a plan change');
    const updated = await tx.subscription.update({ where: { id: sub.id }, data: { planId: plan.id } });
    await tx.license.updateMany({
      where: { subscriptionId: sub.id },
      data: { planCode: plan.code, planName: plan.name, employeeLimit: sub.employeeLimitOverride ?? plan.employeeLimit, userLimit: sub.userLimitOverride ?? plan.userLimit, features: this.featuresOf(plan) },
    });
    await this.event(tx, updated, plan.employeeLimit >= sub.plan.employeeLimit ? 'UPGRADED' : 'DOWNGRADED', { actorUserId, reason, data: { from: sub.plan.code, to: plan.code } });
    await this.audit.record({ tenantId: sub.tenantId, scope: 'PLATFORM', action: 'subscription.plan_changed', entityType: 'Subscription', entityId: sub.id, before: { plan: sub.plan.code }, after: { plan: plan.code }, reason, actorUserId }, tx);
    return updated;
  }

  async adjustCapacity(tx: Tx, subscriptionId: string, input: { employeeLimitOverride: number | null; userLimitOverride: number | null; reason: string }, actorUserId: string) {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
    if (!sub) throw notFound('Subscription');
    const updated = await tx.subscription.update({ where: { id: sub.id }, data: { employeeLimitOverride: input.employeeLimitOverride, userLimitOverride: input.userLimitOverride } });
    await tx.license.updateMany({
      where: { subscriptionId: sub.id },
      data: { employeeLimit: input.employeeLimitOverride ?? sub.plan.employeeLimit, userLimit: input.userLimitOverride ?? sub.plan.userLimit },
    });
    await this.event(tx, updated, 'CAPACITY_ADJUSTED', { actorUserId, reason: input.reason, data: input });
    await this.audit.record(
      { tenantId: sub.tenantId, scope: 'PLATFORM', action: 'subscription.capacity_adjusted', entityType: 'Subscription', entityId: sub.id, before: { employeeLimitOverride: sub.employeeLimitOverride, userLimitOverride: sub.userLimitOverride }, after: input, reason: input.reason, actorUserId },
      tx,
    );
    return updated;
  }

  async setState(tx: Tx, subscriptionId: string, action: 'SUSPEND' | 'REVOKE' | 'REINSTATE', reason: string, actorUserId: string) {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw notFound('Subscription');
    let to: Subscription['status'];
    if (action === 'SUSPEND') {
      if (!['ACTIVE', 'GRACE', 'EXPIRED', 'FREE', 'TRIAL'].includes(sub.status)) throw invalidState(`Cannot suspend a ${sub.status} subscription`);
      to = 'SUSPENDED';
    } else if (action === 'REVOKE') {
      if (['REVOKED', 'SUPERSEDED'].includes(sub.status)) throw invalidState(`Subscription is already ${sub.status}`);
      to = 'REVOKED';
    } else {
      if (!['SUSPENDED', 'REVOKED'].includes(sub.status)) throw invalidState('Only suspended or revoked subscriptions can be reinstated');
      const plan = await tx.plan.findUniqueOrThrow({ where: { id: sub.planId } });
      to = plan.isFree ? 'FREE' : 'ACTIVE';
    }
    const updated = await tx.subscription.update({ where: { id: sub.id }, data: { status: to } });
    await tx.license.updateMany({ where: { subscriptionId: sub.id }, data: { status: to === 'SUSPENDED' ? 'SUSPENDED' : to === 'REVOKED' ? 'REVOKED' : 'ACTIVE' } });
    // Revoking an unredeemed subscription also revokes its outstanding codes.
    if (to === 'REVOKED') await tx.activationCode.updateMany({ where: { subscriptionId: sub.id, status: 'ISSUED' }, data: { status: 'REVOKED', revokedAt: new Date() } });
    await this.event(tx, updated, action === 'REINSTATE' ? 'REINSTATED' : action === 'SUSPEND' ? 'SUSPENDED' : 'REVOKED', { from: sub.status, to, actorUserId, reason });
    await this.audit.record({ tenantId: sub.tenantId, scope: 'PLATFORM', action: `subscription.${action.toLowerCase()}`, entityType: 'Subscription', entityId: sub.id, before: { status: sub.status }, after: { status: to }, reason, actorUserId }, tx);
    return updated;
  }

  /** Persists ACTIVE→GRACE→EXPIRED transitions for reporting (enforcement already uses effective state). */
  async sweepExpirations(now = new Date()): Promise<{ grace: number; expired: number }> {
    let grace = 0;
    let expired = 0;
    const due = await this.prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'GRACE'] }, periodEnd: { lt: now } }, take: 500 });
    for (const sub of due) {
      const to = sub.graceEnd && sub.graceEnd >= now ? 'GRACE' : 'EXPIRED';
      if (to === sub.status) continue;
      await this.prisma.tx(async (tx) => {
        const res = await tx.subscription.updateMany({ where: { id: sub.id, status: sub.status }, data: { status: to } });
        if (res.count === 1) await this.event(tx, sub, to === 'GRACE' ? 'ENTERED_GRACE' : 'EXPIRED', { from: sub.status, to });
      });
      if (to === 'GRACE') grace++;
      else expired++;
    }
    await this.prisma.activationCode.updateMany({ where: { status: 'ISSUED', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
    return { grace, expired };
  }
}
