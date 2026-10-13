import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { Features, TenantPermissions as P } from '@yardhrms/authorization';
import { auditQuery } from '@yardhrms/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { Auth, Permissions, RequireFeature } from '../common/decorators';
import { forbidden } from '../common/errors';
import { paginate } from '../common/util';
import { ZQuery } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { toCsv, toPdf, toXlsx } from './export.util';
import { ReportsService } from './reports.service';
import { loadConfig } from '../config/config';

const reportQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  runId: z.string().optional(),
  departmentId: z.string().optional(),
  format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
});

@ApiTags('Reports & dashboards')
@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('dashboard/hr')
  hr(@Auth() a: AuthContext) {
    return this.reports.hrDashboard(requireTenant(a));
  }

  @Get('dashboard/payroll')
  @Permissions(P.PAYROLL_READ)
  payroll(@Auth() a: AuthContext) {
    return this.reports.payrollDashboard(requireTenant(a));
  }

  @Get('reports')
  catalog(@Auth() a: AuthContext) {
    return this.reports.catalog(requireTenant(a));
  }

  /** IMP-006 / RPT-005: tenant-scoped, permission + entitlement checked; file exports are audited. */
  @Get('reports/:type')
  async run(@Auth() a: AuthContext, @Param('type') type: string, @ZQuery(reportQuery) q: z.infer<typeof reportQuery>, @Res({ passthrough: true }) res: Response) {
    const auth = requireTenant(a);
    const result = await this.reports.run(auth, type, q);
    if (q.format === 'json') return result;
    if (!auth.permissions.has(P.REPORTS_EXPORT)) throw forbidden('You do not have permission to export reports');
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { displayName: true } });
    const banner = result.title.match(/Payroll|Statutory|Employer|Department|Earnings/) && !loadConfig().PAYROLL_COMPLIANCE_CERTIFIED ? 'NOT CERTIFIED FOR LIVE PAYROLL — statutory figures require compliance sign-off' : undefined;
    let buf: Buffer;
    let contentType: string;
    if (q.format === 'csv') {
      buf = toCsv(result);
      contentType = 'text/csv; charset=utf-8';
    } else if (q.format === 'xlsx') {
      buf = await toXlsx(result, tenant.displayName);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      buf = await toPdf(result, tenant.displayName, banner);
      contentType = 'application/pdf';
    }
    await this.prisma.reportExport.create({
      data: { tenantId: auth.tenantId, reportType: type, format: q.format.toUpperCase(), parameters: result.parameters as Prisma.InputJsonValue, rowCount: result.rows.length, createdById: auth.user.id },
    });
    await this.audit.record({ tenantId: auth.tenantId, action: 'report.exported', entityType: 'Report', entityId: type, metadata: { format: q.format, rows: result.rows.length, parameters: result.parameters } });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.${q.format}"`);
    return new StreamableFile(buf);
  }

  @Get('audit')
  @RequireFeature(Features.AUDIT_VIEW)
  @Permissions(P.AUDIT_READ)
  async auditLog(@Auth() a: AuthContext, @ZQuery(auditQuery) q: z.infer<typeof auditQuery>) {
    const auth = requireTenant(a);
    const where: Prisma.AuditEventWhereInput = { tenantId: auth.tenantId };
    if (q.action) where.action = { contains: q.action };
    if (q.entityType) where.entityType = q.entityType;
    if (q.actorUserId) where.actorUserId = q.actorUserId;
    if (q.from || q.to) where.createdAt = { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59.999Z`) : undefined };
    const [total, items] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  }
}
