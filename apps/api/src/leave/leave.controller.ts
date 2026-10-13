import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Features, TenantPermissions as P } from '@yardhrms/authorization';
import { decisionSchema, leaveAdjustmentSchema, leavePolicySchema, leaveRequestSchema, leaveTypeSchema, rejectSchema, workflowListQuery, isoDateField } from '@yardhrms/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { Auth, Permissions, RequireFeature } from '../common/decorators';
import { badRequest, notFound } from '../common/errors';
import { isoDay, toDate } from '../common/util';
import { ZBody, ZQuery } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { LeaveService } from './leave.service';

@ApiTags('Leave')
@RequireFeature(Features.LEAVE)
@Controller('leave')
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Types & policies (LEA-001, LEA-004) ────────────────────────────────
  @Get('types')
  async types(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    return this.prisma.leaveType.findMany({ where: { tenantId: auth.tenantId }, orderBy: { name: 'asc' } });
  }

  @Post('types')
  @Permissions(P.LEAVE_POLICY_MANAGE)
  async createType(@Auth() a: AuthContext, @ZBody(leaveTypeSchema) body: z.infer<typeof leaveTypeSchema>) {
    const auth = requireTenant(a);
    const row = await this.prisma.leaveType.create({ data: { ...body, payPercent: new Prisma.Decimal(body.payPercent), tenantId: auth.tenantId } });
    await this.audit.record({ tenantId: auth.tenantId, action: 'leave.type_created', entityType: 'LeaveType', entityId: row.id, after: body });
    return row;
  }

  @Patch('types/:id')
  @Permissions(P.LEAVE_POLICY_MANAGE)
  async updateType(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(leaveTypeSchema.partial()) body: Partial<z.infer<typeof leaveTypeSchema>>) {
    const auth = requireTenant(a);
    const existing = await this.prisma.leaveType.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!existing) throw notFound('Leave type');
    const row = await this.prisma.leaveType.update({ where: { id }, data: { ...body, payPercent: body.payPercent !== undefined ? new Prisma.Decimal(body.payPercent) : undefined } });
    await this.audit.record({ tenantId: auth.tenantId, action: 'leave.type_updated', entityType: 'LeaveType', entityId: id, before: existing, after: body });
    return row;
  }

  @Get('policies')
  async policies(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    const rows = await this.prisma.leavePolicy.findMany({ where: { tenantId: auth.tenantId }, include: { leaveType: { select: { name: true, code: true } } }, orderBy: [{ leaveTypeId: 'asc' }, { effectiveFrom: 'desc' }] });
    return rows.map((r) => ({ ...r, effectiveFrom: isoDay(r.effectiveFrom) }));
  }

  @Post('policies')
  @Permissions(P.LEAVE_POLICY_MANAGE)
  async createPolicy(@Auth() a: AuthContext, @ZBody(leavePolicySchema) body: z.infer<typeof leavePolicySchema>) {
    const auth = requireTenant(a);
    const type = await this.prisma.leaveType.findFirst({ where: { id: body.leaveTypeId, tenantId: auth.tenantId } });
    if (!type) throw badRequest('Leave type not found');
    if (body.employmentTypeId) {
      const et = await this.prisma.employmentType.findFirst({ where: { id: body.employmentTypeId, tenantId: auth.tenantId } });
      if (!et) throw badRequest('Employment type not found');
    }
    const row = await this.prisma.leavePolicy.create({
      data: {
        tenantId: auth.tenantId,
        leaveTypeId: body.leaveTypeId,
        employmentTypeId: body.employmentTypeId ?? null,
        annualEntitlementDays: new Prisma.Decimal(body.annualEntitlementDays),
        accrualMethod: body.accrualMethod,
        carryForwardMaxDays: new Prisma.Decimal(body.carryForwardMaxDays),
        carryForwardExpiryMonths: body.carryForwardExpiryMonths,
        minServiceMonths: body.minServiceMonths,
        effectiveFrom: toDate(body.effectiveFrom),
        notes: body.notes ?? null,
        createdById: auth.user.id,
      },
    });
    await this.audit.record({ tenantId: auth.tenantId, action: 'leave.policy_created', entityType: 'LeavePolicy', entityId: row.id, after: body });
    return row;
  }

  @Delete('policies/:id')
  @Permissions(P.LEAVE_POLICY_MANAGE)
  @HttpCode(200)
  async deletePolicy(@Auth() a: AuthContext, @Param('id') id: string) {
    const auth = requireTenant(a);
    const existing = await this.prisma.leavePolicy.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!existing) throw notFound('Policy');
    await this.prisma.leavePolicy.delete({ where: { id } });
    await this.audit.record({ tenantId: auth.tenantId, action: 'leave.policy_deleted', entityType: 'LeavePolicy', entityId: id, before: existing });
    return { deleted: true };
  }

  // ── Requests (LEA-002/005/006) ──────────────────────────────────────────
  @Get('requests')
  list(@Auth() a: AuthContext, @ZQuery(workflowListQuery) q: z.infer<typeof workflowListQuery>) {
    return this.leave.list(requireTenant(a), q);
  }

  @Get('requests/:id')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.leave.get(requireTenant(a), id);
  }

  @Get('working-days')
  async workingDays(@Auth() a: AuthContext, @Query('start') start: string, @Query('end') end: string, @Query('halfDayStart') hs?: string, @Query('halfDayEnd') he?: string) {
    const auth = requireTenant(a);
    if (!isoDateField.safeParse(start).success || !isoDateField.safeParse(end).success || end < start) throw badRequest('Provide valid start and end dates');
    return { workingDays: await this.leave.workingDays(auth.tenantId, start, end, hs === 'true', he === 'true') };
  }

  @Post('requests')
  create(@Auth() a: AuthContext, @ZBody(leaveRequestSchema) body: z.infer<typeof leaveRequestSchema>) {
    return this.leave.create(requireTenant(a), body);
  }

  @Post('requests/:id/approve')
  @Permissions(P.LEAVE_APPROVE)
  @HttpCode(200)
  approve(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(decisionSchema) body: z.infer<typeof decisionSchema>) {
    return this.leave.decide(requireTenant(a), id, 'APPROVE', body.comment);
  }

  @Post('requests/:id/reject')
  @Permissions(P.LEAVE_APPROVE)
  @HttpCode(200)
  reject(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(rejectSchema) body: z.infer<typeof rejectSchema>) {
    return this.leave.decide(requireTenant(a), id, 'REJECT', body.comment);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(decisionSchema) body: z.infer<typeof decisionSchema>) {
    return this.leave.cancel(requireTenant(a), id, body.comment);
  }

  // ── Balances & ledger (LEA-004) ────────────────────────────────────────
  @Get('balances')
  async balances(@Auth() a: AuthContext, @Query('employeeId') employeeId?: string) {
    const auth = requireTenant(a);
    const target = employeeId || auth.employeeId;
    if (!target) return [];
    if (target !== auth.employeeId && !auth.permissions.has(P.LEAVE_READ_ANY)) throw notFound('Employee');
    return this.leave.balances(auth.tenantId, target);
  }

  @Get('ledger')
  async ledger(@Auth() a: AuthContext, @Query('employeeId') employeeId: string, @Query('leaveTypeId') leaveTypeId?: string) {
    const auth = requireTenant(a);
    const target = employeeId || auth.employeeId;
    if (!target) return [];
    if (target !== auth.employeeId && !auth.permissions.has(P.LEAVE_READ_ANY)) throw notFound('Employee');
    return this.leave.ledger(auth, target, leaveTypeId);
  }

  @Post('adjustments')
  @Permissions(P.LEAVE_ADJUST)
  adjust(@Auth() a: AuthContext, @ZBody(leaveAdjustmentSchema) body: z.infer<typeof leaveAdjustmentSchema>) {
    return this.leave.adjust(requireTenant(a), body);
  }

  @Post('accruals/run')
  @Permissions(P.LEAVE_ADJUST)
  @HttpCode(200)
  runAccruals(@Auth() a: AuthContext, @ZBody(z.object({ asOf: isoDateField })) body: { asOf: string }) {
    const auth = requireTenant(a);
    return this.leave.runAccruals(auth.tenantId, body.asOf, auth.user.id);
  }

  @Post('year-end')
  @Permissions(P.LEAVE_ADJUST)
  @HttpCode(200)
  yearEnd(@Auth() a: AuthContext, @ZBody(z.object({ year: z.coerce.number().int().min(2000).max(2100) })) body: { year: number }) {
    const auth = requireTenant(a);
    if (body.year >= new Date().getUTCFullYear() && new Date() < new Date(Date.UTC(body.year, 11, 31))) throw badRequest('Year-end can only be processed after 31 December');
    return this.leave.yearEnd(auth.tenantId, body.year, auth.user.id);
  }
}
