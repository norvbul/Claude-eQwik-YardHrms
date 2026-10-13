import { Controller, Get, HttpCode, Param, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Features, TenantPermissions as P } from '@yardhrms/authorization';
import { importMappingSchema } from '@yardhrms/types';
import { z } from 'zod';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { Auth, Permissions, RequireFeature } from '../common/decorators';
import { notFound } from '../common/errors';
import { ZBody } from '../common/zod';
import { ImportsService } from './imports.service';

const kindOf = (t: string) => {
  const k = t.toUpperCase();
  if (k !== 'EMPLOYEES' && k !== 'TIMESHEETS') throw notFound('Import type');
  return k as 'EMPLOYEES' | 'TIMESHEETS';
};

@ApiTags('Imports')
@RequireFeature(Features.BULK_IMPORT)
@Permissions(P.IMPORTS_MANAGE)
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  list(@Auth() a: AuthContext, @Query('page') page?: string) {
    return this.imports.list(requireTenant(a), Math.max(1, Number(page) || 1));
  }

  @Get('templates/:type')
  async template(@Param('type') type: string, @Res({ passthrough: true }) res: Response) {
    const kind = kindOf(type);
    const buf = await this.imports.template(kind);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="yardhrms-${kind.toLowerCase()}-template-v1.xlsx"`);
    return new StreamableFile(buf);
  }

  @Post(':type')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@Auth() a: AuthContext, @Param('type') type: string, @UploadedFile() file: Express.Multer.File) {
    return this.imports.upload(requireTenant(a), kindOf(type), file);
  }

  @Get(':id')
  get(@Auth() a: AuthContext, @Param('id') id: string, @Query('rowPage') rowPage?: string, @Query('outcome') outcome?: string) {
    return this.imports.get(requireTenant(a), id, Math.max(1, Number(rowPage) || 1), outcome || undefined);
  }

  @Get(':id/capacity')
  capacity(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.imports.capacityPreview(requireTenant(a), id);
  }

  @Put(':id/mapping')
  mapping(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(importMappingSchema) body: z.infer<typeof importMappingSchema>) {
    return this.imports.setMapping(requireTenant(a), id, body.mapping);
  }

  @Post(':id/execute')
  @HttpCode(200)
  execute(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.imports.execute(requireTenant(a), id);
  }

  @Get(':id/results.csv')
  async results(@Auth() a: AuthContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const csv = await this.imports.errorsCsv(requireTenant(a), id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="import-${id.slice(0, 8)}-results.csv"`);
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }
}
