import { Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Features, TenantPermissions as P } from '@yardhrms/authorization';
import { bulkDecisionSchema, decisionSchema, overtimeRuleSchema, overtimeSchema, rejectSchema, timesheetSchema, workflowListQuery } from '@yardhrms/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { Auth, Permissions, RequireFeature } from '../common/decorators';
import { notFound } from '../common/errors';
import { ZBody, ZQuery } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { TimeService } from './time.service';

@ApiTags('Timesheets')
@RequireFeature(Features.TIMESHEETS)
@Controller('timesheets')
export class TimesheetsController {
  constructor(private readonly time: TimeService) {}

  @Get()
  list(@Auth() a: AuthContext, @ZQuery(workflowListQuery) q: z.infer<typeof workflowListQuery>) {
    return this.time.listTimesheets(requireTenant(a), q);
  }

  @Post()
  create(@Auth() a: AuthContext, @ZBody(timesheetSchema) body: z.infer<typeof timesheetSchema>) {
    return this.time.createTimesheet(requireTenant(a), body);
  }

  @Post(':id/approve')
  @Permissions(P.TIMESHEETS_APPROVE)
  @HttpCode(200)
  approve(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(decisionSchema) body: z.infer<typeof decisionSchema>) {
    return this.time.decideTimesheet(requireTenant(a), id, 'APPROVE', body.comment);
  }

  @Post(':id/reject')
  @Permissions(P.TIMESHEETS_APPROVE)
  @HttpCode(200)
  reject(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(rejectSchema) body: z.infer<typeof rejectSchema>) {
    return this.time.decideTimesheet(requireTenant(a), id, 'REJECT', body.comment);
  }

  @Post('bulk-approve')
  @Permissions(P.TIMESHEETS_APPROVE)
  @HttpCode(200)
  async bulkApprove(@Auth() a: AuthContext, @ZBody(bulkDecisionSchema) body: z.infer<typeof bulkDecisionSchema>) {
    const auth = requireTenant(a);
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of body.ids) {
      try {
        await this.time.decideTimesheet(auth, id, 'APPROVE', body.comment);
        results.push({ id, ok: true });
      } catch (e: any) {
        results.push({ id, ok: false, error: e?.response?.message ?? e.message });
      }
    }
    return { results, approved: results.filter((r) => r.ok).length };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.time.cancelTimesheet(requireTenant(a), id);
  }
}

@ApiTags('Overtime')
@RequireFeature(Features.OVERTIME)
@Controller('overtime')
export class OvertimeController {
  constructor(
    private readonly time: TimeService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('rules')
  async rules(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    return this.prisma.overtimeRule.findMany({ where: { tenantId: auth.tenantId }, orderBy: { name: 'asc' } });
  }

  @Post('rules')
  @Permissions(P.PAYROLL_CONFIG_MANAGE)
  async createRule(@Auth() a: AuthContext, @ZBody(overtimeRuleSchema) body: z.infer<typeof overtimeRuleSchema>) {
    const auth = requireTenant(a);
    const row = await this.prisma.overtimeRule.create({ data: { ...body, multiplier: new Prisma.Decimal(body.multiplier), description: body.description ?? null, tenantId: auth.tenantId } });
    await this.audit.record({ tenantId: auth.tenantId, action: 'overtime.rule_created', entityType: 'OvertimeRule', entityId: row.id, after: body });
    return row;
  }

  /** Changing a multiplier applies prospectively: existing requests keep their multiplier snapshot (CFG-005). */
  @Patch('rules/:id')
  @Permissions(P.PAYROLL_CONFIG_MANAGE)
  async updateRule(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(overtimeRuleSchema.partial()) body: Partial<z.infer<typeof overtimeRuleSchema>>) {
    const auth = requireTenant(a);
    const existing = await this.prisma.overtimeRule.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!existing) throw notFound('Overtime rule');
    const row = await this.prisma.overtimeRule.update({ where: { id }, data: { ...body, multiplier: body.multiplier ? new Prisma.Decimal(body.multiplier) : undefined } });
    await this.audit.record({ tenantId: auth.tenantId, action: 'overtime.rule_updated', entityType: 'OvertimeRule', entityId: id, before: existing, after: body });
    return row;
  }

  @Get()
  list(@Auth() a: AuthContext, @ZQuery(workflowListQuery) q: z.infer<typeof workflowListQuery>) {
    return this.time.listOvertime(requireTenant(a), q);
  }

  @Post()
  create(@Auth() a: AuthContext, @ZBody(overtimeSchema) body: z.infer<typeof overtimeSchema>) {
    return this.time.createOvertime(requireTenant(a), body);
  }

  @Post(':id/approve')
  @Permissions(P.OVERTIME_APPROVE)
  @HttpCode(200)
  approve(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(decisionSchema) body: z.infer<typeof decisionSchema>) {
    return this.time.decideOvertime(requireTenant(a), id, 'APPROVE', body.comment);
  }

  @Post(':id/reject')
  @Permissions(P.OVERTIME_APPROVE)
  @HttpCode(200)
  reject(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(rejectSchema) body: z.infer<typeof rejectSchema>) {
    return this.time.decideOvertime(requireTenant(a), id, 'REJECT', body.comment);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.time.cancelOvertime(requireTenant(a), id);
  }
}
