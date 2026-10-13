import { Controller, Get, Patch, Post, Put, Res, StreamableFile, UploadedFile, UseInterceptors, HttpCode } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { TenantPermissions as P } from '@yardhrms/authorization';
import { companyProfileSchema, JAMAICAN_PARISHES, payFrequencySettingsSchema } from '@yardhrms/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { AnyPermission, Auth, Permissions } from '../common/decorators';
import { notFound } from '../common/errors';
import { diff } from '../common/util';
import { ZBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@ApiTags('Company')
@Controller()
export class CompanyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  @Get('tenants/current')
  async current(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
    const { currentSubscriptionId: _s, nextEmployeeSeq: _n, logoKey, ...rest } = t;
    return { ...rest, logoUrl: logoKey ? `/api/v1/tenants/current/logo?v=${t.updatedAt.getTime()}` : null };
  }

  /** AC-15: company-name changes propagate to header, sidebar, payslips and exports (all read from the tenant record). */
  @Patch('tenants/current')
  @Permissions(P.SETTINGS_WRITE)
  async update(@Auth() a: AuthContext, @ZBody(companyProfileSchema) body: z.infer<typeof companyProfileSchema>) {
    const auth = requireTenant(a);
    const before = await this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
    const updated = await this.prisma.tenant.update({ where: { id: auth.tenantId }, data: body });
    const d = diff(before as any, body as any);
    await this.audit.record({ tenantId: auth.tenantId, action: 'tenant.profile_updated', entityType: 'Tenant', entityId: auth.tenantId, before: d.before, after: d.after });
    return updated;
  }

  @Post('tenants/current/logo')
  @Permissions(P.SETTINGS_WRITE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  @HttpCode(200)
  async uploadLogo(@Auth() a: AuthContext, @UploadedFile() file: Express.Multer.File) {
    const auth = requireTenant(a);
    const type = this.storage.validateUpload(file, 'logo');
    const key = this.storage.key(`tenants/${auth.tenantId}`, 'branding', 'logo');
    await this.storage.put(key, file.buffer, type);
    const prev = await this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { logoKey: true } });
    await this.prisma.tenant.update({ where: { id: auth.tenantId }, data: { logoKey: key } });
    if (prev.logoKey) await this.storage.remove(prev.logoKey).catch(() => undefined);
    await this.audit.record({ tenantId: auth.tenantId, action: 'tenant.logo_updated', entityType: 'Tenant', entityId: auth.tenantId });
    return { uploaded: true };
  }

  @Get('tenants/current/logo')
  async logo(@Auth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    const auth = requireTenant(a);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { logoKey: true } });
    if (!t.logoKey) throw notFound('Logo');
    const buf = await this.storage.get(t.logoKey);
    const type = buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : 'image/webp';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return new StreamableFile(buf);
  }

  @Get('reference-data')
  async referenceData(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    const t = { tenantId: auth.tenantId };
    const [departments, branches, positions, employmentTypes, shiftTypes, leaveTypes, overtimeRules, allowanceTypes, deductionTypes, payFrequencies, publicHolidays] = await Promise.all([
      this.prisma.department.findMany({ where: t, orderBy: { name: 'asc' } }),
      this.prisma.branch.findMany({ where: t, orderBy: { name: 'asc' } }),
      this.prisma.position.findMany({ where: t, orderBy: { name: 'asc' } }),
      this.prisma.employmentType.findMany({ where: t, orderBy: { name: 'asc' } }),
      this.prisma.shiftType.findMany({ where: t, orderBy: { name: 'asc' } }),
      this.prisma.leaveType.findMany({ where: t, orderBy: { name: 'asc' } }),
      this.prisma.overtimeRule.findMany({ where: t, orderBy: { name: 'asc' } }),
      this.prisma.allowanceType.findMany({ where: t, orderBy: { name: 'asc' } }),
      this.prisma.deductionType.findMany({ where: t, orderBy: { name: 'asc' } }),
      this.prisma.payFrequencyConfig.findMany({ where: t }),
      this.prisma.publicHoliday.findMany({ where: t, orderBy: { date: 'asc' } }),
    ]);
    return { departments, branches, positions, employmentTypes, shiftTypes, leaveTypes, overtimeRules, allowanceTypes, deductionTypes, payFrequencies, publicHolidays, parishes: JAMAICAN_PARISHES };
  }

  @Get('settings/payroll')
  @AnyPermission(P.SETTINGS_READ, P.PAYROLL_READ, P.PAYROLL_CONFIG_MANAGE)
  async payrollSettings(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    const [items, tenant] = await Promise.all([
      this.prisma.payFrequencyConfig.findMany({ where: { tenantId: auth.tenantId }, orderBy: { periodsPerYear: 'desc' } }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { requireSeparateApprover: true, taxYearStartMonth: true } }),
    ]);
    return { items, requireSeparateApprover: tenant.requireSeparateApprover, taxYearStartMonth: tenant.taxYearStartMonth };
  }

  /** CFG-003/CFG-005: standard hours (incl. Monthly 173.33 default) are configuration, applied prospectively. */
  @Put('settings/payroll')
  @Permissions(P.PAYROLL_CONFIG_MANAGE)
  async updatePayrollSettings(@Auth() a: AuthContext, @ZBody(payFrequencySettingsSchema) body: z.infer<typeof payFrequencySettingsSchema>) {
    const auth = requireTenant(a);
    const before = await this.prisma.payFrequencyConfig.findMany({ where: { tenantId: auth.tenantId } });
    await this.prisma.tx(async (tx) => {
      for (const item of body.items) {
        await tx.payFrequencyConfig.upsert({
          where: { tenantId_frequency: { tenantId: auth.tenantId, frequency: item.frequency } },
          create: { tenantId: auth.tenantId, frequency: item.frequency, standardHours: new Prisma.Decimal(item.standardHours), workingDays: new Prisma.Decimal(item.workingDays), periodsPerYear: item.periodsPerYear, active: item.active },
          update: { standardHours: new Prisma.Decimal(item.standardHours), workingDays: new Prisma.Decimal(item.workingDays), periodsPerYear: item.periodsPerYear, active: item.active },
        });
      }
      await tx.tenant.update({ where: { id: auth.tenantId }, data: { requireSeparateApprover: body.requireSeparateApprover, taxYearStartMonth: body.taxYearStartMonth } });
      await this.audit.record({ tenantId: auth.tenantId, action: 'settings.payroll_updated', entityType: 'PayFrequencyConfig', before, after: body }, tx);
    });
    return this.payrollSettings(a);
  }
}
