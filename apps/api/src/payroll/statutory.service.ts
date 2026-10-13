import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JAMAICA_REFERENCE_PACKS, validateRuleSet, type StatutoryRuleSet } from '@yardhrms/payroll-engine';
import type { StatutoryVersionInput } from '@yardhrms/types';
import { AuditService } from '../audit/audit.service';
import type { TenantAuth } from '../auth/auth-context';
import { badRequest, businessRule, forbidden, invalidState, notFound } from '../common/errors';
import { decOrNull, isoDay, toDate } from '../common/util';
import { PrismaService, Tx } from '../prisma/prisma.service';

const VERSION_INCLUDE = { components: { include: { brackets: { orderBy: { sequence: 'asc' } } }, orderBy: { sortOrder: 'asc' } } } satisfies Prisma.StatutoryRuleVersionInclude;
type VersionFull = Prisma.StatutoryRuleVersionGetPayload<{ include: typeof VERSION_INCLUDE }>;

/**
 * Effective-dated, versioned statutory rules (PAY-004/005, CFG-004/005). Rates are tenant configuration
 * entered from authoritative sources; a version must be APPROVED (by someone other than its author,
 * with an attestation) before payroll can use it. Approved versions are immutable and remain available
 * for reproducing historical payroll.
 */
@Injectable()
export class StatutoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  present(v: VersionFull) {
    return {
      ...v,
      effectiveFrom: isoDay(v.effectiveFrom),
      effectiveTo: isoDay(v.effectiveTo),
      components: v.components.map((c) => ({
        ...c,
        employeeRate: c.employeeRate.toString(),
        employerRate: c.employerRate.toString(),
        annualCeiling: c.annualCeiling?.toString() ?? null,
        annualThreshold: c.annualThreshold?.toString() ?? null,
        brackets: c.brackets.map((b) => ({ upToAnnual: b.upToAnnual?.toString() ?? null, rate: b.rate.toString() })),
      })),
    };
  }

  toRuleSet(v: VersionFull): StatutoryRuleSet {
    return {
      versionId: v.id,
      versionName: v.name,
      approved: v.status === 'APPROVED',
      components: v.components.map((c) => ({
        code: c.code,
        name: c.name,
        sortOrder: c.sortOrder,
        base: c.base,
        employeeRate: c.employeeRate.toString(),
        employerRate: c.employerRate.toString(),
        annualCeiling: c.annualCeiling?.toString() ?? null,
        annualThreshold: c.annualThreshold?.toString() ?? null,
        reducesStatutoryIncome: c.reducesStatutoryIncome,
        minAge: c.minAge,
        maxAge: c.maxAge,
        calculationMethod: c.calculationMethod,
        bracketBasis: c.bracketBasis,
        brackets: c.brackets.map((b) => ({ upToAnnual: b.upToAnnual?.toString() ?? null, rate: b.rate.toString() })),
      })),
    };
  }

  /** Researched reference packs offered for import (never used for calculation until approved). */
  referencePacks() {
    return JAMAICA_REFERENCE_PACKS.map((p) => ({ key: p.key, name: p.name, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, researchedOn: p.researchedOn, sources: p.sources, verify: p.verify, components: p.components }));
  }

  /** Creates a DRAFT version from a reference pack; a second authorised user must verify and approve it. */
  async importReferencePack(auth: TenantAuth, key: string) {
    const p = JAMAICA_REFERENCE_PACKS.find((x) => x.key === key);
    if (!p) throw notFound('Reference pack');
    const sourceReference = `Reference pack ${p.key} (researched ${p.researchedOn}). VERIFY against: ${p.sources.map((s) => s.title.split(' — ')[0]).join('; ')}`.slice(0, 500);
    const v = await this.create(auth, {
      name: p.name.slice(0, 120),
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo,
      sourceReference,
      components: p.components.map((c) => ({
        code: c.code,
        name: c.name,
        sortOrder: c.sortOrder,
        base: c.base,
        employeeRate: c.employeeRate,
        employerRate: c.employerRate,
        annualCeiling: c.annualCeiling ?? null,
        annualThreshold: c.annualThreshold ?? null,
        reducesStatutoryIncome: !!c.reducesStatutoryIncome,
        minAge: c.minAge ?? null,
        maxAge: c.maxAge ?? null,
        brackets: (c.brackets ?? []).map((b) => ({ upToAnnual: b.upToAnnual, rate: b.rate })),
        calculationMethod: c.calculationMethod ?? 'PERIOD',
        bracketBasis: c.bracketBasis ?? 'AFTER_THRESHOLD',
        notes: c.notes.slice(0, 500),
      })),
    });
    await this.audit.record({ tenantId: auth.tenantId, action: 'statutory.reference_pack_imported', entityType: 'StatutoryRuleVersion', entityId: v.id, metadata: { key: p.key } });
    return v;
  }

  async list(tenantId: string) {
    const rows = await this.prisma.statutoryRuleVersion.findMany({ where: { tenantId }, include: VERSION_INCLUDE, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    return rows.map((r) => this.present(r));
  }

  async get(tenantId: string, id: string, client: Tx | PrismaService = this.prisma) {
    const v = await client.statutoryRuleVersion.findFirst({ where: { id, tenantId }, include: VERSION_INCLUDE });
    if (!v) throw notFound('Statutory rule version');
    return v;
  }

  /** Selects the APPROVED version effective on `on` (latest effectiveFrom ≤ on, not ended before on). */
  async effectiveVersion(tenantId: string, on: Date, client: Tx | PrismaService = this.prisma): Promise<VersionFull | null> {
    return client.statutoryRuleVersion.findFirst({
      where: { tenantId, status: 'APPROVED', effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }] },
      include: VERSION_INCLUDE,
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  private validate(input: StatutoryVersionInput) {
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw badRequest('Effective-to must be after effective-from');
    const issues = validateRuleSet(
      input.components.map((c) => ({ ...c, annualCeiling: c.annualCeiling ?? null, annualThreshold: c.annualThreshold ?? null, brackets: c.brackets.map((b) => ({ upToAnnual: b.upToAnnual ?? null, rate: b.rate })) })),
    );
    if (issues.length) throw badRequest(`Rule version is invalid: ${issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`, { issues });
  }

  private async writeComponents(tx: Tx, tenantId: string, versionId: string, input: StatutoryVersionInput) {
    for (const c of input.components) {
      await tx.statutoryComponent.create({
        data: {
          tenantId,
          versionId,
          code: c.code,
          name: c.name,
          sortOrder: c.sortOrder,
          base: c.base,
          employeeRate: new Prisma.Decimal(c.employeeRate),
          employerRate: new Prisma.Decimal(c.employerRate),
          annualCeiling: decOrNull(c.annualCeiling),
          annualThreshold: decOrNull(c.annualThreshold),
          reducesStatutoryIncome: c.reducesStatutoryIncome,
          minAge: c.minAge ?? null,
          maxAge: c.maxAge ?? null,
          calculationMethod: c.calculationMethod ?? 'PERIOD',
          bracketBasis: c.bracketBasis ?? 'AFTER_THRESHOLD',
          notes: c.notes ?? null,
          brackets: { create: c.brackets.map((b, i) => ({ sequence: i + 1, upToAnnual: decOrNull(b.upToAnnual), rate: new Prisma.Decimal(b.rate) })) },
        },
      });
    }
  }

  async create(auth: TenantAuth, input: StatutoryVersionInput) {
    this.validate(input);
    const id = await this.prisma.tx(async (tx) => {
      const v = await tx.statutoryRuleVersion.create({
        data: { tenantId: auth.tenantId, name: input.name, effectiveFrom: toDate(input.effectiveFrom), effectiveTo: toDate(input.effectiveTo), sourceReference: input.sourceReference ?? null, createdById: auth.user.id },
      });
      await this.writeComponents(tx, auth.tenantId, v.id, input);
      await this.audit.record({ tenantId: auth.tenantId, action: 'statutory.version_created', entityType: 'StatutoryRuleVersion', entityId: v.id, after: input }, tx);
      return v.id;
    });
    return this.present(await this.get(auth.tenantId, id));
  }

  async update(auth: TenantAuth, id: string, input: StatutoryVersionInput) {
    this.validate(input);
    await this.prisma.tx(async (tx) => {
      const v = await this.get(auth.tenantId, id, tx);
      if (v.status !== 'DRAFT') throw invalidState('Only DRAFT versions can be edited. Clone an approved version to make changes.');
      await tx.statutoryComponent.deleteMany({ where: { versionId: id } });
      await tx.statutoryRuleVersion.update({
        where: { id },
        data: { name: input.name, effectiveFrom: toDate(input.effectiveFrom), effectiveTo: toDate(input.effectiveTo), sourceReference: input.sourceReference ?? null },
      });
      await this.writeComponents(tx, auth.tenantId, id, input);
      await this.audit.record({ tenantId: auth.tenantId, action: 'statutory.version_updated', entityType: 'StatutoryRuleVersion', entityId: id, before: this.present(v), after: input }, tx);
    });
    return this.present(await this.get(auth.tenantId, id));
  }

  async approve(auth: TenantAuth, id: string, attestation: string) {
    await this.prisma.tx(async (tx) => {
      const v = await this.get(auth.tenantId, id, tx);
      if (v.status !== 'DRAFT') throw invalidState('Only DRAFT versions can be approved');
      if (v.createdById === auth.user.id) throw forbidden('Separation of duties: the author of a rule version cannot approve it');
      const issues = validateRuleSet(this.toRuleSet(v).components);
      if (issues.length) throw badRequest(`Rule version is invalid: ${issues.map((i) => i.message).join('; ')}`);
      const allZero = v.components.every((c) => c.employeeRate.isZero() && c.employerRate.isZero() && c.brackets.length === 0);
      if (allZero) throw businessRule('All rates are zero. Enter the verified statutory rates before approval.');
      // Close the previous open-ended approved version the day before this one starts.
      const prev = await tx.statutoryRuleVersion.findMany({ where: { tenantId: auth.tenantId, status: 'APPROVED', effectiveFrom: { lt: v.effectiveFrom }, effectiveTo: null } });
      for (const p of prev) {
        await tx.statutoryRuleVersion.update({ where: { id: p.id }, data: { effectiveTo: new Date(v.effectiveFrom.getTime() - 86_400_000) } });
      }
      const sameStart = await tx.statutoryRuleVersion.findFirst({ where: { tenantId: auth.tenantId, status: 'APPROVED', effectiveFrom: v.effectiveFrom } });
      if (sameStart) throw businessRule('Another approved version already starts on this date. Retire it first.');
      await tx.statutoryRuleVersion.update({ where: { id }, data: { status: 'APPROVED', approvedById: auth.user.id, approvedAt: new Date(), attestation } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'statutory.version_approved', entityType: 'StatutoryRuleVersion', entityId: id, reason: attestation, after: this.present(v) }, tx);
    });
    return this.present(await this.get(auth.tenantId, id));
  }

  async retire(auth: TenantAuth, id: string, reason: string) {
    const v = await this.get(auth.tenantId, id);
    if (v.status === 'RETIRED') throw invalidState('Already retired');
    const inUse = await this.prisma.payrollRun.count({ where: { tenantId: auth.tenantId, ruleVersionId: id, status: { in: ['DRAFT', 'PREPARED', 'REVIEWED'] } } });
    if (inUse) throw businessRule('This version is used by payroll runs that are still in progress');
    await this.prisma.statutoryRuleVersion.update({ where: { id }, data: { status: 'RETIRED' } });
    await this.audit.record({ tenantId: auth.tenantId, action: 'statutory.version_retired', entityType: 'StatutoryRuleVersion', entityId: id, reason });
    return { retired: true };
  }

  async clone(auth: TenantAuth, id: string) {
    const v = this.present(await this.get(auth.tenantId, id));
    return this.create(auth, {
      name: `${v.name} (copy)`.slice(0, 120),
      effectiveFrom: v.effectiveFrom!,
      effectiveTo: null,
      sourceReference: v.sourceReference,
      components: v.components.map((c) => ({
        code: c.code,
        name: c.name,
        sortOrder: c.sortOrder,
        base: c.base,
        employeeRate: c.employeeRate,
        employerRate: c.employerRate,
        annualCeiling: c.annualCeiling,
        annualThreshold: c.annualThreshold,
        reducesStatutoryIncome: c.reducesStatutoryIncome,
        minAge: c.minAge,
        maxAge: c.maxAge,
        brackets: c.brackets,
        calculationMethod: c.calculationMethod,
        bracketBasis: c.bracketBasis,
        notes: c.notes,
      })),
    });
  }
}
