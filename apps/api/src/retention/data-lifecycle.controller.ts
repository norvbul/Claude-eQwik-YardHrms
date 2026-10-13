import { Controller, Get, HttpCode, Param, Post, Put, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformPermissions as PP, TenantPermissions as P } from '@yardhrms/authorization';
import { RETENTION_RULES, deletionDecisionSchema, deletionRequestSchema, legalHoldSchema, retentionPolicySchema } from '@yardhrms/types';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { requireTenant, type AuthContext, type TenantAuth } from '../auth/auth-context';
import { AllowReadOnly, Auth, Permissions, PlatformRoute } from '../common/decorators';
import { badRequest, businessRule, forbidden, invalidState, notFound } from '../common/errors';
import { ZBody } from '../common/zod';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DataExportService } from './data-export.service';
import { RetentionService } from './retention.service';

const COOLING_OFF_DAYS = 30;

function requireCompanyAdmin(a: AuthContext): TenantAuth {
  const auth = requireTenant(a);
  if (!auth.roles.includes('COMPANY_ADMIN')) throw forbidden('Only a Company Administrator can manage data retention, exports and account closure');
  return auth;
}

/** NFR-011 for the company: retention policy, full data export, account closure request. */
@ApiTags('Data lifecycle')
@Controller('data')
@AllowReadOnly()
export class DataLifecycleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly retention: RetentionService,
    private readonly exports: DataExportService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  @Get('retention')
  @Permissions(P.SETTINGS_READ)
  async getRetention(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { legalHold: true, legalHoldReason: true, status: true } });
    const runs = await this.prisma.retentionRun.findMany({ where: { tenantId: auth.tenantId, finishedAt: { not: null } }, orderBy: { startedAt: 'desc' }, take: 5 });
    return { policy: await this.retention.policy(auth.tenantId), rules: RETENTION_RULES, legalHold: t.legalHold, legalHoldReason: t.legalHoldReason, recentRuns: runs };
  }

  @Put('retention')
  @Permissions(P.SETTINGS_WRITE)
  async setRetention(@Auth() a: AuthContext, @ZBody(retentionPolicySchema) body: z.infer<typeof retentionPolicySchema>) {
    const auth = requireCompanyAdmin(a);
    const before = await this.retention.policy(auth.tenantId);
    const after = { ...before, ...body };
    await this.prisma.tenant.update({ where: { id: auth.tenantId }, data: { retentionPolicy: after } });
    await this.audit.record({ tenantId: auth.tenantId, action: 'retention.policy_updated', entityType: 'Tenant', entityId: auth.tenantId, before, after });
    return this.getRetention(a);
  }

  @Get('exports')
  @Permissions(P.SETTINGS_READ)
  async listExports(@Auth() a: AuthContext) {
    const auth = requireCompanyAdmin(a);
    return this.prisma.dataExport.findMany({ where: { tenantId: auth.tenantId }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, status: true, sizeBytes: true, sha256: true, expiresAt: true, completedAt: true, createdAt: true, error: true } });
  }

  @Post('exports')
  @Permissions(P.SETTINGS_READ)
  async requestExport(@Auth() a: AuthContext) {
    const auth = requireCompanyAdmin(a);
    const e = await this.exports.request(auth.tenantId, auth.user.id);
    return { id: e.id, status: e.status };
  }

  @Get('exports/:id/download')
  @Permissions(P.SETTINGS_READ)
  async download(@Auth() a: AuthContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const auth = requireCompanyAdmin(a);
    const e = await this.prisma.dataExport.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!e) throw notFound('Export');
    if (e.status !== 'READY' || !e.storageKey) throw invalidState(`This export is ${e.status.toLowerCase()}`);
    const buf = await this.storage.get(e.storageKey);
    await this.audit.record({ tenantId: auth.tenantId, action: 'data.export_downloaded', entityType: 'DataExport', entityId: e.id });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="yardhrms-export-${e.createdAt.toISOString().slice(0, 10)}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(buf);
  }

  @Get('deletion-requests')
  @Permissions(P.SETTINGS_READ)
  async deletionRequests(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    return this.prisma.deletionRequest.findMany({ where: { tenantId: auth.tenantId }, orderBy: { createdAt: 'desc' }, take: 10 });
  }

  /** Account closure: typed confirmation, 30-day cooling-off, Qwik approval, then execution by the daily job. */
  @Post('deletion-requests')
  @Permissions(P.SETTINGS_WRITE)
  async requestDeletion(@Auth() a: AuthContext, @ZBody(deletionRequestSchema) body: z.infer<typeof deletionRequestSchema>) {
    const auth = requireCompanyAdmin(a);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
    if (![tenant.legalName, tenant.displayName].some((n) => n.trim().toLowerCase() === body.confirmName.trim().toLowerCase())) {
      throw badRequest('Type the organization name exactly to confirm', { fieldErrors: { confirmName: ['Does not match the organization name'] } });
    }
    const open = await this.prisma.deletionRequest.findFirst({ where: { tenantId: auth.tenantId, status: { in: ['PENDING', 'APPROVED'] } } });
    if (open) throw businessRule('A closure request is already in progress');
    const purgeAfter = await this.retention.statutoryPurgeDate(auth.tenantId);
    const r = await this.prisma.tx(async (tx) => {
      const req = await tx.deletionRequest.create({ data: { tenantId: auth.tenantId, requestedById: auth.user.id, reason: body.reason, coolingOffUntil: new Date(Date.now() + COOLING_OFF_DAYS * 86_400_000) } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'tenant.closure_requested', entityType: 'DeletionRequest', entityId: req.id, reason: body.reason }, tx);
      const admins = await tx.tenantMembership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE', roles: { some: { role: { code: 'COMPANY_ADMIN' } } } }, select: { userId: true } });
      await this.notifications.notify(tx, {
        tenantId: auth.tenantId,
        userIds: admins.map((x) => x.userId),
        excludeUserId: auth.user.id,
        category: 'subscription',
        type: 'closure_requested',
        title: 'Account closure requested',
        body: `${auth.user.fullName} asked to close ${tenant.displayName} on eQwik YardHRMS. Nothing happens before ${req.coolingOffUntil.toISOString().slice(0, 10)}; any Company Administrator can cancel the request until then.`,
        link: '/app/settings/data',
        dedupeKey: `closure:${req.id}`,
      });
      return req;
    });
    return { ...r, statutoryRecordsKeptUntil: purgeAfter.toISOString().slice(0, 10) };
  }

  @Post('deletion-requests/:id/cancel')
  @Permissions(P.SETTINGS_WRITE)
  @HttpCode(200)
  async cancelDeletion(@Auth() a: AuthContext, @Param('id') id: string) {
    const auth = requireCompanyAdmin(a);
    const res = await this.prisma.deletionRequest.updateMany({ where: { id, tenantId: auth.tenantId, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'CANCELLED', decidedAt: new Date(), decisionNote: `Cancelled by ${auth.user.email}` } });
    if (!res.count) throw invalidState('Only pending or approved requests can be cancelled');
    await this.audit.record({ tenantId: auth.tenantId, action: 'tenant.closure_cancelled', entityType: 'DeletionRequest', entityId: id });
    return { cancelled: true };
  }
}

/** Qwik side: approve/reject closures, legal holds. */
@ApiTags('Qwik Platform — Data lifecycle')
@PlatformRoute()
@Controller('platform')
export class PlatformDataLifecycleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly retention: RetentionService,
  ) {}

  @Get('deletion-requests')
  @Permissions(PP.TENANTS_LIFECYCLE)
  async list() {
    const rows = await this.prisma.deletionRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, displayName: true, legalHold: true, status: true } });
    return rows.map((r) => ({ ...r, tenant: tenants.find((t) => t.id === r.tenantId) ?? null }));
  }

  @Post('deletion-requests/:id/approve')
  @Permissions(PP.TENANTS_LIFECYCLE)
  @HttpCode(200)
  async approve(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(deletionDecisionSchema) body: z.infer<typeof deletionDecisionSchema>) {
    const r = await this.prisma.deletionRequest.findUnique({ where: { id } });
    if (!r) throw notFound('Deletion request');
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: r.tenantId } });
    if (t.legalHold) throw businessRule('The organization is under legal hold; lift the hold before approving closure');
    const res = await this.prisma.deletionRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', decidedById: a.user.id, decidedAt: new Date(), decisionNote: body.note } });
    if (!res.count) throw invalidState('Only pending requests can be approved');
    await this.audit.record({ tenantId: r.tenantId, scope: 'PLATFORM', action: 'tenant.closure_approved', entityType: 'DeletionRequest', entityId: id, reason: body.note, actorUserId: a.user.id });
    return { approved: true, executesAfter: r.coolingOffUntil };
  }

  @Post('deletion-requests/:id/reject')
  @Permissions(PP.TENANTS_LIFECYCLE)
  @HttpCode(200)
  async reject(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(deletionDecisionSchema) body: z.infer<typeof deletionDecisionSchema>) {
    const res = await this.prisma.deletionRequest.updateMany({ where: { id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'REJECTED', decidedById: a.user.id, decidedAt: new Date(), decisionNote: body.note } });
    if (!res.count) throw invalidState('Only pending or approved requests can be rejected');
    const r = await this.prisma.deletionRequest.findUniqueOrThrow({ where: { id } });
    await this.audit.record({ tenantId: r.tenantId, scope: 'PLATFORM', action: 'tenant.closure_rejected', entityType: 'DeletionRequest', entityId: id, reason: body.note, actorUserId: a.user.id });
    return { rejected: true };
  }

  @Post('tenants/:id/legal-hold')
  @Permissions(PP.TENANTS_LIFECYCLE)
  @HttpCode(200)
  async legalHold(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(legalHoldSchema) body: z.infer<typeof legalHoldSchema>) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw notFound('Tenant');
    await this.prisma.tenant.update({ where: { id }, data: { legalHold: body.enabled, legalHoldReason: body.enabled ? body.reason : null } });
    await this.audit.record({ tenantId: id, scope: 'PLATFORM', action: body.enabled ? 'tenant.legal_hold_placed' : 'tenant.legal_hold_lifted', entityType: 'Tenant', entityId: id, reason: body.reason ?? null, actorUserId: a.user.id });
    return { legalHold: body.enabled };
  }

  @Post('retention/run')
  @Permissions(PP.TENANTS_LIFECYCLE)
  @HttpCode(200)
  async runNow() {
    return this.retention.runAll();
  }
}
