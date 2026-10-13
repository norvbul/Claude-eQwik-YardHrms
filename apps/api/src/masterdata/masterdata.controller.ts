import { Controller, Delete, Get, Param, Patch, Post, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantPermissions as P } from '@yardhrms/authorization';
import { branchSchema, departmentSchema, employmentTypeSchema, positionSchema, publicHolidaySchema, shiftTypeSchema } from '@yardhrms/types';
import { z, type ZodObject } from 'zod';
import { AuditService } from '../audit/audit.service';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { Auth, Permissions } from '../common/decorators';
import { badRequest, conflict, notFound } from '../common/errors';
import { toDate } from '../common/util';
import { ZodValidationPipe } from '../common/zod';
import { Body } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Kind = 'departments' | 'branches' | 'positions' | 'employment-types' | 'shift-types' | 'public-holidays';

const SCHEMAS: Record<Kind, ZodObject<any>> = {
  departments: departmentSchema,
  branches: branchSchema,
  positions: positionSchema,
  'employment-types': employmentTypeSchema,
  'shift-types': shiftTypeSchema,
  'public-holidays': publicHolidaySchema,
};

/** CFG-002: branches, departments, positions, employment types, shift types and public holidays. */
@ApiTags('Company master data')
@Controller('master-data')
export class MasterDataController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private delegate(kind: string): any {
    switch (kind as Kind) {
      case 'departments':
        return this.prisma.department;
      case 'branches':
        return this.prisma.branch;
      case 'positions':
        return this.prisma.position;
      case 'employment-types':
        return this.prisma.employmentType;
      case 'shift-types':
        return this.prisma.shiftType;
      case 'public-holidays':
        return this.prisma.publicHoliday;
      default:
        throw notFound('Master data type');
    }
  }

  private parse(kind: string, body: unknown, partial = false) {
    const schema = SCHEMAS[kind as Kind];
    if (!schema) throw notFound('Master data type');
    const data = new ZodValidationPipe(partial ? schema.partial() : schema).transform(body, { type: 'body' }) as Record<string, any>;
    if (kind === 'public-holidays' && data.date) data.date = toDate(data.date);
    return data;
  }

  private async assertTenantRefs(tenantId: string, data: Record<string, any>) {
    if (data.departmentId) {
      const d = await this.prisma.department.findFirst({ where: { id: data.departmentId, tenantId } });
      if (!d) throw badRequest('Department not found');
    }
  }

  @Get(':kind')
  async list(@Auth() a: AuthContext, @Param('kind') kind: string) {
    const auth = requireTenant(a);
    return this.delegate(kind).findMany({ where: { tenantId: auth.tenantId }, orderBy: kind === 'public-holidays' ? { date: 'asc' } : { name: 'asc' } });
  }

  @Post(':kind')
  @Permissions(P.MASTER_DATA_WRITE)
  async create(@Auth() a: AuthContext, @Param('kind') kind: string, @Body() body: unknown) {
    const auth = requireTenant(a);
    const data = this.parse(kind, body);
    await this.assertTenantRefs(auth.tenantId, data);
    const created = await this.delegate(kind).create({ data: { ...data, tenantId: auth.tenantId } });
    await this.audit.record({ tenantId: auth.tenantId, action: `masterdata.${kind}.created`, entityType: kind, entityId: created.id, after: data });
    return created;
  }

  @Patch(':kind/:id')
  @Permissions(P.MASTER_DATA_WRITE)
  async update(@Auth() a: AuthContext, @Param('kind') kind: string, @Param('id') id: string, @Body() body: unknown) {
    const auth = requireTenant(a);
    const data = this.parse(kind, body, true);
    await this.assertTenantRefs(auth.tenantId, data);
    const existing = await this.delegate(kind).findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!existing) throw notFound();
    const updated = await this.delegate(kind).update({ where: { id: existing.id }, data });
    await this.audit.record({ tenantId: auth.tenantId, action: `masterdata.${kind}.updated`, entityType: kind, entityId: id, before: existing, after: data });
    return updated;
  }

  /** Records referenced by employees are deactivated rather than deleted (historical integrity). */
  @Delete(':kind/:id')
  @Permissions(P.MASTER_DATA_WRITE)
  @HttpCode(200)
  async remove(@Auth() a: AuthContext, @Param('kind') kind: string, @Param('id') id: string) {
    const auth = requireTenant(a);
    const existing = await this.delegate(kind).findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!existing) throw notFound();
    if (kind === 'public-holidays' || kind === 'shift-types') {
      await this.delegate(kind).delete({ where: { id } });
      await this.audit.record({ tenantId: auth.tenantId, action: `masterdata.${kind}.deleted`, entityType: kind, entityId: id, before: existing });
      return { deleted: true };
    }
    const field = { departments: 'departmentId', branches: 'branchId', positions: 'positionId', 'employment-types': 'employmentTypeId' }[kind as 'departments'];
    const inUse = await this.prisma.employee.count({ where: { tenantId: auth.tenantId, [field]: id } });
    if (inUse > 0) {
      if (!existing.active) throw conflict('Record is already inactive and still referenced by employees');
      await this.delegate(kind).update({ where: { id }, data: { active: false } });
      await this.audit.record({ tenantId: auth.tenantId, action: `masterdata.${kind}.deactivated`, entityType: kind, entityId: id, reason: `Referenced by ${inUse} employee(s)` });
      return { deleted: false, deactivated: true, referencedBy: inUse };
    }
    await this.delegate(kind).delete({ where: { id } });
    await this.audit.record({ tenantId: auth.tenantId, action: `masterdata.${kind}.deleted`, entityType: kind, entityId: id, before: existing });
    return { deleted: true };
  }
}

export type MasterDataBody = z.infer<typeof departmentSchema>;
