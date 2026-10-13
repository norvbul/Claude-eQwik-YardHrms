import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantPermissions as P } from '@yardhrms/authorization';
import { redeemCodeSchema } from '@yardhrms/types';
import { z } from 'zod';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { AllowReadOnly, Auth, Permissions, RateLimit } from '../common/decorators';
import { invalidState } from '../common/errors';
import { ZBody } from '../common/zod';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { LicensingCore } from '../licensing/licensing-core.service';
import { PrismaService } from '../prisma/prisma.service';

/** LIC-008: tenant admins see plan, status, renewal/expiry, entitlements, usage and the code-entry form. Always reachable (even when expired). */
@ApiTags('Tenant subscription')
@AllowReadOnly()
@Controller('subscription')
export class SubscriptionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly licensing: LicensingCore,
  ) {}

  @Get()
  @Permissions(P.SUBSCRIPTION_READ)
  async current(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: auth.tenantId },
      include: { currentSubscription: { include: { plan: { include: { features: { include: { feature: true } } } }, license: true } } },
    });
    const sub = tenant.currentSubscription;
    const [summary, events] = await Promise.all([
      this.entitlements.summary(auth.tenantId),
      this.prisma.subscriptionEvent.findMany({ where: { tenantId: auth.tenantId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, type: true, fromStatus: true, toStatus: true, createdAt: true, reason: true } }),
    ]);
    return {
      summary,
      subscription: sub
        ? {
            id: sub.id,
            status: summary.status,
            source: sub.source,
            periodStart: sub.periodStart,
            periodEnd: sub.periodEnd,
            graceEnd: sub.graceEnd,
            plan: { code: sub.plan.code, name: sub.plan.name, isFree: sub.plan.isFree, durationMonths: sub.plan.durationMonths, gracePeriodDays: sub.plan.gracePeriodDays },
            licenseKey: sub.license?.licenseKey ?? null,
          }
        : null,
      features: sub?.plan.features.map((f) => ({ code: f.featureCode, name: f.feature.name, enabled: f.enabled && summary.features.includes(f.featureCode) })) ?? [],
      history: events,
    };
  }

  @Get('usage')
  @Permissions(P.SUBSCRIPTION_READ)
  usage(@Auth() a: AuthContext) {
    return this.entitlements.summary(requireTenant(a).tenantId);
  }

  @Get('plans')
  @Permissions(P.SUBSCRIPTION_READ)
  async plans() {
    const plans = await this.prisma.plan.findMany({ where: { status: 'ACTIVE' }, include: { features: { include: { feature: true } } }, orderBy: { employeeLimit: 'asc' } });
    return plans.map((p) => ({
      code: p.code,
      name: p.name,
      isFree: p.isFree,
      price: p.price?.toString() ?? null,
      currency: p.currency,
      durationMonths: p.durationMonths,
      employeeLimit: p.employeeLimit,
      userLimit: p.userLimit,
      features: p.features.filter((f) => f.enabled).map((f) => f.feature.name),
    }));
  }

  /** AC-04/AC-05: atomic one-time redemption bound to this tenant. */
  @Post('redeem-code')
  @Permissions(P.SUBSCRIPTION_MANAGE)
  @RateLimit(10, 3600)
  @HttpCode(200)
  async redeem(@Auth() a: AuthContext, @ZBody(redeemCodeSchema) body: z.infer<typeof redeemCodeSchema>) {
    const auth = requireTenant(a);
    const sub = await this.licensing.redeemCode(body.code, auth.tenantId, auth.user.id);
    return { activated: true, subscriptionId: sub.id, periodEnd: sub.periodEnd, summary: await this.entitlements.summary(auth.tenantId) };
  }

  /** LIC-007: recovers a tenant without any subscription (e.g. migrated) onto the Free plan. */
  @Post('start-free')
  @Permissions(P.SUBSCRIPTION_MANAGE)
  @HttpCode(200)
  async startFree(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    await this.prisma.tx(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
      if (tenant.currentSubscriptionId) throw invalidState('This organization already has a subscription');
      let customer = await tx.customer.findUnique({ where: { tenantId: auth.tenantId } });
      customer ??= await tx.customer.create({ data: { name: tenant.legalName, tenantId: tenant.id, email: tenant.email } });
      await this.licensing.startFree(tx, auth.tenantId, customer.id, auth.user.id);
    });
    return this.entitlements.summary(auth.tenantId);
  }
}
