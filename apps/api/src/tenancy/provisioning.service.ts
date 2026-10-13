import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ALL_PLATFORM_PERMISSIONS,
  ALL_TENANT_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PLATFORM_PERMISSION_DESCRIPTIONS,
  TENANT_ROLE_TEMPLATES,
} from '@yardhrms/authorization';
import { AuditService } from '../audit/audit.service';
import { invalidState } from '../common/errors';
import { slugify } from '../common/util';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { LicensingCore } from '../licensing/licensing-core.service';

export const DEFAULT_PAY_FREQUENCIES = [
  { frequency: 'WEEKLY' as const, standardHours: '40.00', workingDays: '5.00', periodsPerYear: 52 },
  { frequency: 'FORTNIGHTLY' as const, standardHours: '80.00', workingDays: '10.00', periodsPerYear: 26 },
  /** PRD CFG-003 / TIM-002: Monthly default 173.33 standard hours — stored as editable configuration. */
  { frequency: 'MONTHLY' as const, standardHours: '173.33', workingDays: '21.67', periodsPerYear: 12 },
];

/** Leave categories (LEA-001). Entitlement days are NOT seeded — each company configures its policy. */
export const DEFAULT_LEAVE_TYPES = [
  { code: 'VAC', name: 'Vacation / Annual leave', category: 'ANNUAL' as const, payPercent: 100, requiresDocument: false },
  { code: 'SICK', name: 'Sick leave', category: 'SICK' as const, payPercent: 100, requiresDocument: true },
  { code: 'MAT', name: 'Maternity leave', category: 'MATERNITY' as const, payPercent: 100, requiresDocument: true },
  { code: 'COMP', name: 'Compassionate leave', category: 'COMPASSIONATE' as const, payPercent: 100, requiresDocument: false },
  { code: 'UNPD', name: 'Unpaid leave', category: 'UNPAID' as const, payPercent: 0, requiresDocument: false },
  { code: 'STDY', name: 'Study leave', category: 'STUDY' as const, payPercent: 100, requiresDocument: false },
  { code: 'SPEC', name: 'Special leave', category: 'SPECIAL' as const, payPercent: 100, requiresDocument: false },
];

/**
 * Statutory component STRUCTURE for a new tenant. Rates/thresholds are intentionally 0/blank:
 * PRD §6.7 compliance guardrail — no unverified Jamaican statutory figures are shipped. The version is
 * a DRAFT that must be completed from authoritative sources and approved before payroll can use it.
 */
export const STATUTORY_TEMPLATE = [
  { code: 'NIS', name: 'National Insurance Scheme', sortOrder: 10, base: 'TAXABLE_GROSS' as const, reducesStatutoryIncome: true },
  { code: 'NHT', name: 'National Housing Trust', sortOrder: 20, base: 'GROSS' as const, reducesStatutoryIncome: false },
  { code: 'EDTAX', name: 'Education Tax', sortOrder: 30, base: 'STATUTORY_INCOME' as const, reducesStatutoryIncome: false },
  { code: 'PAYE', name: 'Income Tax (PAYE)', sortOrder: 40, base: 'STATUTORY_INCOME' as const, reducesStatutoryIncome: false },
  { code: 'HEART', name: 'HEART/NSTA Trust (employer)', sortOrder: 50, base: 'GROSS' as const, reducesStatutoryIncome: false },
];

@Injectable()
export class ProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly licensing: LicensingCore,
  ) {}

  /** Idempotently registers all permission codes (FK targets for role_permissions). */
  async ensurePermissions(tx: Tx | PrismaService = this.prisma) {
    await tx.permission.createMany({
      data: [
        ...ALL_TENANT_PERMISSIONS.map((code) => ({ code, description: PERMISSION_DESCRIPTIONS[code], scope: 'TENANT' })),
        ...ALL_PLATFORM_PERMISSIONS.map((code) => ({ code, description: PLATFORM_PERMISSION_DESCRIPTIONS[code], scope: 'PLATFORM' })),
      ],
      skipDuplicates: true,
    });
  }

  async uniqueSlug(tx: Tx, base: string): Promise<string> {
    const root = slugify(base) || 'company';
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      const exists = await tx.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!exists) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  /**
   * Creates a tenant with roles, default configuration, the primary admin membership, a linked
   * customer record and a centrally registered Free subscription (PRD §5.1, LIC-007, AC-01).
   */
  async provisionTenant(
    tx: Tx,
    input: { legalName: string; displayName: string; adminUserId: string; email?: string | null; contactName?: string | null; createFreeSubscription?: boolean },
  ) {
    await this.ensurePermissions(tx);
    const slug = await this.uniqueSlug(tx, input.displayName);
    const tenant = await tx.tenant.create({ data: { legalName: input.legalName, displayName: input.displayName, slug, email: input.email ?? null } });

    const roleIds: Record<string, string> = {};
    for (const tpl of TENANT_ROLE_TEMPLATES) {
      const role = await tx.role.create({
        data: { tenantId: tenant.id, code: tpl.code, name: tpl.name, description: tpl.description, isSystem: true, privileged: tpl.privileged },
      });
      roleIds[tpl.code] = role.id;
      await tx.rolePermission.createMany({ data: tpl.permissions.map((p) => ({ roleId: role.id, permissionCode: p })) });
    }

    const membership = await tx.tenantMembership.create({ data: { tenantId: tenant.id, userId: input.adminUserId, status: 'ACTIVE' } });
    await tx.membershipRole.create({ data: { membershipId: membership.id, roleId: roleIds.COMPANY_ADMIN } });

    await tx.payFrequencyConfig.createMany({
      data: DEFAULT_PAY_FREQUENCIES.map((f) => ({ tenantId: tenant.id, frequency: f.frequency, standardHours: new Prisma.Decimal(f.standardHours), workingDays: new Prisma.Decimal(f.workingDays), periodsPerYear: f.periodsPerYear })),
    });
    await tx.leaveType.createMany({ data: DEFAULT_LEAVE_TYPES.map((t) => ({ tenantId: tenant.id, ...t, payPercent: new Prisma.Decimal(t.payPercent) })) });
    await tx.employmentType.createMany({
      data: [
        { tenantId: tenant.id, code: 'FT', name: 'Full-time' },
        { tenantId: tenant.id, code: 'PT', name: 'Part-time' },
        { tenantId: tenant.id, code: 'CON', name: 'Contract' },
        { tenantId: tenant.id, code: 'TMP', name: 'Temporary' },
      ],
    });
    const version = await tx.statutoryRuleVersion.create({
      data: {
        tenantId: tenant.id,
        name: 'Statutory rules — DRAFT (requires compliance completion & approval)',
        effectiveFrom: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
        status: 'DRAFT',
        sourceReference: 'Structure only. Enter rates, thresholds and ceilings from authoritative Jamaican sources (TAJ/NIS/NHT notices) and have them approved.',
        createdById: input.adminUserId,
      },
    });
    for (const c of STATUTORY_TEMPLATE) {
      await tx.statutoryComponent.create({
        data: {
          tenantId: tenant.id,
          versionId: version.id,
          code: c.code,
          name: c.name,
          sortOrder: c.sortOrder,
          base: c.base,
          employeeRate: new Prisma.Decimal(0),
          employerRate: new Prisma.Decimal(0),
          reducesStatutoryIncome: c.reducesStatutoryIncome,
          notes: 'Rate not set — requires verified statutory figure',
        },
      });
    }

    const customer = await tx.customer.create({
      data: { name: input.legalName, email: input.email ?? null, contactName: input.contactName ?? null, tenantId: tenant.id },
    });

    if (input.createFreeSubscription !== false) {
      await this.licensing.startFree(tx, tenant.id, customer.id, input.adminUserId);
    }

    await this.audit.record(
      { tenantId: tenant.id, action: 'tenant.registered', entityType: 'Tenant', entityId: tenant.id, after: { legalName: input.legalName, displayName: input.displayName, slug }, actorUserId: input.adminUserId },
      tx,
    );
    return { tenant, membership, customer };
  }

  async assertNotDuplicateMembership(tx: Tx, tenantId: string, userId: string) {
    const m = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
    if (m) throw invalidState('User already belongs to this organization');
  }
}
