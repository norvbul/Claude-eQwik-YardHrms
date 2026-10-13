import { Injectable } from '@nestjs/common';
import {
  effectiveSubscriptionState,
  isReadOnlyState,
  type FeatureCode,
  type SubscriptionState,
} from '@yardhrms/authorization';
import type { EntitlementSummary } from '@yardhrms/types';
import { AppError, capacityExceeded } from '../common/errors';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { ErrorCodes } from '@yardhrms/types';

export interface Entitlements {
  tenantId: string;
  subscriptionId: string | null;
  planCode: string;
  planName: string;
  status: SubscriptionState;
  readOnly: boolean;
  periodEnd: Date | null;
  graceEnd: Date | null;
  employeeLimit: number;
  userLimit: number;
  features: Set<string>;
}

/**
 * Licence entitlement layer (PRD LIC-008/010/011). Independent of RBAC. All enforcement is server-side:
 * - feature checks per route (@RequireFeature)
 * - read-only mode for EXPIRED/SUSPENDED/REVOKED subscriptions (non-GET writes rejected)
 * - transactional capacity checks for employees and users.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async forTenant(tenantId: string, client: Tx | PrismaService = this.prisma): Promise<Entitlements> {
    const tenant = await client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        status: true,
        currentSubscription: { include: { license: true, plan: { include: { features: true } } } },
      },
    });
    const sub = tenant?.currentSubscription;
    if (!tenant || !sub) {
      // A tenant without a subscription is treated as locked until provisioned.
      return {
        tenantId,
        subscriptionId: null,
        planCode: 'NONE',
        planName: 'No subscription',
        status: 'SUSPENDED',
        readOnly: true,
        periodEnd: null,
        graceEnd: null,
        employeeLimit: 0,
        userLimit: 0,
        features: new Set(),
      };
    }
    let status = effectiveSubscriptionState({ status: sub.status as SubscriptionState, periodEnd: sub.periodEnd, graceEnd: sub.graceEnd });
    if (tenant.status === 'SUSPENDED') status = 'SUSPENDED';
    const lic = sub.license;
    const features = new Set<string>(
      lic ? ((lic.features as string[]) ?? []) : sub.plan.features.filter((f) => f.enabled).map((f) => f.featureCode),
    );
    return {
      tenantId,
      subscriptionId: sub.id,
      planCode: lic?.planCode ?? sub.plan.code,
      planName: lic?.planName ?? sub.plan.name,
      status,
      readOnly: isReadOnlyState(status),
      periodEnd: sub.periodEnd,
      graceEnd: sub.graceEnd,
      employeeLimit: sub.employeeLimitOverride ?? lic?.employeeLimit ?? sub.plan.employeeLimit,
      userLimit: sub.userLimitOverride ?? lic?.userLimit ?? sub.plan.userLimit,
      features,
    };
  }

  hasFeature(ent: Entitlements, feature: FeatureCode): boolean {
    return ent.features.has(feature);
  }

  assertFeature(ent: Entitlements, feature: FeatureCode) {
    if (!ent.features.has(feature)) {
      throw new AppError(ErrorCodes.FEATURE_NOT_ENTITLED, `Your ${ent.planName} plan does not include ${feature.replace('_', ' ').toLowerCase()}. Upgrade your subscription to use this feature.`, 402, {
        feature,
        plan: ent.planCode,
      });
    }
  }

  assertWritable(ent: Entitlements) {
    if (ent.readOnly) {
      throw new AppError(
        ErrorCodes.SUBSCRIPTION_READ_ONLY,
        `Your subscription is ${ent.status.toLowerCase()}. Historical records remain available to view and export, but changes are blocked until the subscription is renewed.`,
        402,
        { status: ent.status },
      );
    }
  }

  countActiveEmployees(client: Tx | PrismaService, tenantId: string) {
    return client.employee.count({ where: { tenantId, status: 'ACTIVE', deletedAt: null } });
  }

  /** Seats are consumed by ACTIVE memberships and pending INVITED memberships (reserved seats). */
  countActiveUsers(client: Tx | PrismaService, tenantId: string) {
    return client.tenantMembership.count({ where: { tenantId, status: { in: ['ACTIVE', 'INVITED'] } } });
  }

  /**
   * Must be called inside the same transaction that creates/reactivates employees. Locks the tenant row
   * so concurrent requests cannot both pass the check (LIC-011, AC-02).
   */
  async assertEmployeeCapacity(tx: Tx, tenantId: string, additional = 1): Promise<void> {
    await this.prisma.lockTenant(tx, tenantId);
    const ent = await this.forTenant(tenantId, tx);
    const current = await this.countActiveEmployees(tx, tenantId);
    if (current + additional > ent.employeeLimit) {
      throw capacityExceeded(
        `Your ${ent.planName} plan allows ${ent.employeeLimit} active employees (currently ${current}). Deactivate an employee or upgrade your subscription.`,
        { limit: ent.employeeLimit, current, requested: additional },
      );
    }
  }

  async assertUserCapacity(tx: Tx, tenantId: string, additional = 1): Promise<void> {
    await this.prisma.lockTenant(tx, tenantId);
    const ent = await this.forTenant(tenantId, tx);
    const current = await this.countActiveUsers(tx, tenantId);
    if (current + additional > ent.userLimit) {
      throw capacityExceeded(`Your ${ent.planName} plan allows ${ent.userLimit} active users (currently ${current}). Deactivate a user or upgrade your subscription.`, {
        limit: ent.userLimit,
        current,
        requested: additional,
      });
    }
  }

  async summary(tenantId: string): Promise<EntitlementSummary> {
    const ent = await this.forTenant(tenantId);
    const [activeEmployees, activeUsers] = await Promise.all([this.countActiveEmployees(this.prisma, tenantId), this.countActiveUsers(this.prisma, tenantId)]);
    return {
      planCode: ent.planCode,
      planName: ent.planName,
      status: ent.status,
      readOnly: ent.readOnly,
      periodEnd: ent.periodEnd?.toISOString() ?? null,
      graceEnd: ent.graceEnd?.toISOString() ?? null,
      employeeLimit: ent.employeeLimit,
      userLimit: ent.userLimit,
      activeEmployees,
      activeUsers,
      features: [...ent.features].sort(),
    };
  }
}
