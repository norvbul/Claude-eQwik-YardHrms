import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { Features, TenantPermissions as P } from '@yardhrms/authorization';
import {
  allowanceTypeSchema,
  deductionTypeSchema,
  payrollAdjustmentSchema,
  payrollReverseSchema,
  payrollRunCreateSchema,
  payrollTransitionSchema,
  statutoryApproveSchema,
  statutoryVersionSchema,
} from '@yardhrms/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { AllowReadOnly, AnyPermission, Auth, Permissions, RequireFeature } from '../common/decorators';
import { CryptoService } from '../common/crypto.service';
import { businessRule, notFound } from '../common/errors';
import { isoDay } from '../common/util';
import { ZBody, ZQuery } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PayrollService } from './payroll.service';
import { PayslipService } from './payslip.service';
import { StatutoryService } from './statutory.service';

@ApiTags('Payroll setup')
@RequireFeature(Features.PAYROLL)
@Controller('payroll')
export class PayrollSetupController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly statutory: StatutoryService,
  ) {}

  @Get('allowance-types')
  @AnyPermission(P.PAYROLL_READ, P.COMPENSATION_READ, P.PAYROLL_CONFIG_MANAGE)
  async allowanceTypes(@Auth() a: AuthContext) {
    return this.prisma.allowanceType.findMany({ where: { tenantId: requireTenant(a).tenantId }, orderBy: { name: 'asc' } });
  }

  @Post('allowance-types')
  @Permissions(P.PAYROLL_CONFIG_MANAGE)
  async createAllowanceType(@Auth() a: AuthContext, @ZBody(allowanceTypeSchema) body: z.infer<typeof allowanceTypeSchema>) {
    const auth = requireTenant(a);
    const row = await this.prisma.allowanceType.create({ data: { ...body, tenantId: auth.tenantId } });
    await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.allowance_type_created', entityType: 'AllowanceType', entityId: row.id, after: body });
    return row;
  }

  @Patch('allowance-types/:id')
  @Permissions(P.PAYROLL_CONFIG_MANAGE)
  async updateAllowanceType(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(allowanceTypeSchema.partial()) body: Partial<z.infer<typeof allowanceTypeSchema>>) {
    const auth = requireTenant(a);
    const existing = await this.prisma.allowanceType.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!existing) throw notFound('Allowance type');
    const row = await this.prisma.allowanceType.update({ where: { id }, data: body });
    await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.allowance_type_updated', entityType: 'AllowanceType', entityId: id, before: existing, after: body });
    return row;
  }

  @Get('deduction-types')
  @AnyPermission(P.PAYROLL_READ, P.COMPENSATION_READ, P.PAYROLL_CONFIG_MANAGE)
  async deductionTypes(@Auth() a: AuthContext) {
    return this.prisma.deductionType.findMany({ where: { tenantId: requireTenant(a).tenantId }, orderBy: { name: 'asc' } });
  }

  @Post('deduction-types')
  @Permissions(P.PAYROLL_CONFIG_MANAGE)
  async createDeductionType(@Auth() a: AuthContext, @ZBody(deductionTypeSchema) body: z.infer<typeof deductionTypeSchema>) {
    const auth = requireTenant(a);
    const row = await this.prisma.deductionType.create({ data: { ...body, tenantId: auth.tenantId } });
    await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.deduction_type_created', entityType: 'DeductionType', entityId: row.id, after: body });
    return row;
  }

  @Patch('deduction-types/:id')
  @Permissions(P.PAYROLL_CONFIG_MANAGE)
  async updateDeductionType(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(deductionTypeSchema.partial()) body: Partial<z.infer<typeof deductionTypeSchema>>) {
    const auth = requireTenant(a);
    const existing = await this.prisma.deductionType.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!existing) throw notFound('Deduction type');
    const row = await this.prisma.deductionType.update({ where: { id }, data: body });
    await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.deduction_type_updated', entityType: 'DeductionType', entityId: id, before: existing, after: body });
    return row;
  }

  // ── Statutory rule versions ─────────────────────────────────────────────
  @Get('statutory-versions')
  @AnyPermission(P.PAYROLL_READ, P.STATUTORY_MANAGE, P.STATUTORY_APPROVE)
  listVersions(@Auth() a: AuthContext) {
    return this.statutory.list(requireTenant(a).tenantId);
  }

  @Get('statutory-versions/:id')
  @AnyPermission(P.PAYROLL_READ, P.STATUTORY_MANAGE, P.STATUTORY_APPROVE)
  async getVersion(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.statutory.present(await this.statutory.get(requireTenant(a).tenantId, id));
  }

  @Post('statutory-versions')
  @Permissions(P.STATUTORY_MANAGE)
  createVersion(@Auth() a: AuthContext, @ZBody(statutoryVersionSchema) body: z.infer<typeof statutoryVersionSchema>) {
    return this.statutory.create(requireTenant(a), body);
  }

  @Put('statutory-versions/:id')
  @Permissions(P.STATUTORY_MANAGE)
  updateVersion(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(statutoryVersionSchema) body: z.infer<typeof statutoryVersionSchema>) {
    return this.statutory.update(requireTenant(a), id, body);
  }

  @Post('statutory-versions/:id/approve')
  @Permissions(P.STATUTORY_APPROVE)
  @HttpCode(200)
  approveVersion(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(statutoryApproveSchema) body: z.infer<typeof statutoryApproveSchema>) {
    return this.statutory.approve(requireTenant(a), id, body.attestation);
  }

  @Post('statutory-versions/:id/retire')
  @Permissions(P.STATUTORY_APPROVE)
  @HttpCode(200)
  retireVersion(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(payrollReverseSchema) body: z.infer<typeof payrollReverseSchema>) {
    return this.statutory.retire(requireTenant(a), id, body.reason);
  }

  @Post('statutory-versions/:id/clone')
  @Permissions(P.STATUTORY_MANAGE)
  @HttpCode(200)
  cloneVersion(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.statutory.clone(requireTenant(a), id);
  }
}

const runListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['DRAFT', 'PREPARED', 'REVIEWED', 'APPROVED', 'LOCKED']).optional(),
  frequency: z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY']).optional(),
});

@ApiTags('Payroll runs')
@Controller('payroll-runs')
export class PayrollRunsController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Reads remain available in read-only (expired) mode for historical access. */
  @Get()
  @Permissions(P.PAYROLL_READ)
  list(@Auth() a: AuthContext, @ZQuery(runListQuery) q: z.infer<typeof runListQuery>) {
    return this.payroll.list(requireTenant(a).tenantId, q);
  }

  @Post()
  @RequireFeature(Features.PAYROLL)
  @Permissions(P.PAYROLL_PREPARE)
  create(@Auth() a: AuthContext, @ZBody(payrollRunCreateSchema) body: z.infer<typeof payrollRunCreateSchema>) {
    return this.payroll.create(requireTenant(a), body);
  }

  @Get(':id')
  @Permissions(P.PAYROLL_READ)
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.payroll.detail(requireTenant(a).tenantId, id);
  }

  @Post(':id/prepare')
  @RequireFeature(Features.PAYROLL)
  @Permissions(P.PAYROLL_PREPARE)
  @HttpCode(200)
  prepare(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.payroll.prepare(requireTenant(a), id);
  }

  @Post(':id/review')
  @RequireFeature(Features.PAYROLL)
  @Permissions(P.PAYROLL_REVIEW)
  @HttpCode(200)
  review(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(payrollTransitionSchema) body: z.infer<typeof payrollTransitionSchema>) {
    return this.payroll.review(requireTenant(a), id, body.comment);
  }

  @Post(':id/reopen')
  @RequireFeature(Features.PAYROLL)
  @Permissions(P.PAYROLL_PREPARE)
  @HttpCode(200)
  reopen(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(payrollTransitionSchema) body: z.infer<typeof payrollTransitionSchema>) {
    return this.payroll.reopen(requireTenant(a), id, body.comment);
  }

  @Post(':id/approve')
  @RequireFeature(Features.PAYROLL)
  @Permissions(P.PAYROLL_APPROVE)
  @HttpCode(200)
  approve(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(payrollTransitionSchema) body: z.infer<typeof payrollTransitionSchema>) {
    return this.payroll.approve(requireTenant(a), id, body.comment);
  }

  @Post(':id/lock')
  @RequireFeature(Features.PAYROLL)
  @Permissions(P.PAYROLL_LOCK)
  @HttpCode(200)
  lock(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.payroll.lock(requireTenant(a), id);
  }

  @Post(':id/reverse')
  @RequireFeature(Features.PAYROLL)
  @Permissions(P.PAYROLL_REVERSE)
  @HttpCode(200)
  reverse(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(payrollReverseSchema) body: z.infer<typeof payrollReverseSchema>) {
    return this.payroll.reverse(requireTenant(a), id, body.reason);
  }

  @Delete(':id')
  @RequireFeature(Features.PAYROLL)
  @Permissions(P.PAYROLL_PREPARE)
  @HttpCode(200)
  remove(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.payroll.remove(requireTenant(a), id);
  }

  @Post(':id/adjustments')
  @RequireFeature(Features.PAYROLL)
  @Permissions(P.PAYROLL_PREPARE)
  addAdjustment(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(payrollAdjustmentSchema) body: z.infer<typeof payrollAdjustmentSchema>) {
    return this.payroll.addAdjustment(requireTenant(a), id, body);
  }

  @Delete(':id/adjustments/:adjId')
  @RequireFeature(Features.PAYROLL)
  @Permissions(P.PAYROLL_PREPARE)
  @HttpCode(200)
  removeAdjustment(@Auth() a: AuthContext, @Param('id') id: string, @Param('adjId') adjId: string) {
    return this.payroll.removeAdjustment(requireTenant(a), id, adjId);
  }

  /** PAY-009: controlled bank-upload file (CSV/XLSX). Full account numbers are decrypted only into the file. */
  @Post(':id/bank-file')
  @AllowReadOnly()
  @Permissions(P.PAYROLL_EXPORT)
  @HttpCode(200)
  async bankFile(@Auth() a: AuthContext, @Param('id') id: string, @Query('format') format: string = 'csv', @Res({ passthrough: true }) res: Response) {
    const auth = requireTenant(a);
    const run = await this.payroll.getRun(auth.tenantId, id);
    if (!['APPROVED', 'LOCKED'].includes(run.status)) throw businessRule('Bank files can only be generated for approved payroll');
    if (run.runType === 'REVERSAL') throw businessRule('Reversal runs do not produce bank payments');
    const rows = await this.prisma.payrollRunEmployee.findMany({ where: { runId: id }, orderBy: { employeeName: 'asc' } });
    const accounts = await this.prisma.employeeBankAccount.findMany({ where: { tenantId: auth.tenantId, employeeId: { in: rows.map((r) => r.employeeId) }, isPrimary: true, deletedAt: null } });
    const data: (string | number)[][] = [];
    const missing: string[] = [];
    let total = new Prisma.Decimal(0);
    for (const r of rows) {
      if (r.netPay.lessThanOrEqualTo(0)) continue;
      const acct = accounts.find((x) => x.employeeId === r.employeeId);
      if (!acct) {
        missing.push(`${r.employeeNumber} ${r.employeeName}`);
        continue;
      }
      total = total.plus(r.netPay);
      data.push([r.employeeNumber, r.employeeName, acct.bankName, acct.branchCode ?? '', acct.accountType, this.crypto.decryptNullable(acct.accountNumberEnc) ?? '', r.netPay.toFixed(2), isoDay(run.period.payDate)!, `${run.runNumber}`]);
    }
    const header = ['Employee Number', 'Employee Name', 'Bank', 'Branch Code', 'Account Type', 'Account Number', 'Amount', 'Pay Date', 'Reference'];
    let buf: Buffer;
    let contentType: string;
    const fmt = format === 'xlsx' ? 'xlsx' : 'csv';
    if (fmt === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Bank file');
      ws.addRow(header);
      data.forEach((d) => ws.addRow(d));
      ws.getRow(1).font = { bold: true };
      buf = Buffer.from(await wb.xlsx.writeBuffer());
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      const esc = (v: string | number) => {
        const s = String(v);
        const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // CSV formula-injection guard
        return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      buf = Buffer.from([header, ...data].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n', 'utf8');
      contentType = 'text/csv';
    }
    const key = this.storage.key(`tenants/${auth.tenantId}`, 'bank-files', id, `bank-${run.runNumber}.${fmt}`);
    await this.storage.put(key, buf, contentType);
    const batch = await this.prisma.bankExportBatch.create({
      data: { tenantId: auth.tenantId, runId: id, format: fmt.toUpperCase(), rowCount: data.length, totalAmount: total, storageKey: key, sha256: this.crypto.sha256(buf), createdById: auth.user.id },
    });
    await this.audit.record({ tenantId: auth.tenantId, action: 'payroll.bank_file_generated', entityType: 'BankExportBatch', entityId: batch.id, metadata: { runId: id, rows: data.length, total: total.toFixed(2), missingBankAccounts: missing.length } });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="bank-${run.runNumber}.${fmt}"`);
    res.setHeader('X-Missing-Bank-Accounts', String(missing.length));
    return new StreamableFile(buf);
  }

  @Get(':id/bank-files')
  @Permissions(P.PAYROLL_EXPORT)
  async bankFiles(@Auth() a: AuthContext, @Param('id') id: string) {
    const auth = requireTenant(a);
    const rows = await this.prisma.bankExportBatch.findMany({ where: { tenantId: auth.tenantId, runId: id }, orderBy: { createdAt: 'desc' } });
    return rows.map(({ storageKey: _k, ...r }) => r);
  }
}

const payslipQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  employeeId: z.string().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

/** Payslip access stays available in read-only mode (historical access after expiry — AC-11). */
@ApiTags('Payslips')
@Controller('payslips')
export class PayslipsController {
  constructor(private readonly payslips: PayslipService) {}

  @Get()
  @AnyPermission(P.PAYSLIPS_READ_SELF, P.PAYSLIPS_PRINT_ANY)
  list(@Auth() a: AuthContext, @ZQuery(payslipQuery) q: z.infer<typeof payslipQuery>) {
    return this.payslips.list(requireTenant(a), q);
  }

  @Get(':id/download')
  @AnyPermission(P.PAYSLIPS_READ_SELF, P.PAYSLIPS_PRINT_ANY)
  async download(@Auth() a: AuthContext, @Param('id') id: string, @Query('inline') inline: string | undefined, @Res({ passthrough: true }) res: Response) {
    const { buf, fileName } = await this.payslips.download(requireTenant(a), id, inline === 'true' ? 'VIEW' : 'DOWNLOAD');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline === 'true' ? 'inline' : 'attachment'}; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(buf);
  }

  @Post(':id/print-event')
  @AllowReadOnly()
  @AnyPermission(P.PAYSLIPS_READ_SELF, P.PAYSLIPS_PRINT_ANY)
  @HttpCode(200)
  async print(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.payslips.recordAccess(requireTenant(a), id, 'PRINT');
    return { recorded: true };
  }

  @Get(':id/access-log')
  @Permissions(P.PAYSLIPS_PRINT_ANY)
  accessLog(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.payslips.accessLog(requireTenant(a), id);
  }
}
