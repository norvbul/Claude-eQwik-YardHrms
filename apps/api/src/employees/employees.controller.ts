import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Features, TenantPermissions as P } from '@yardhrms/authorization';
import {
  bankAccountSchema,
  compensationChangeSchema,
  emergencyContactSchema,
  employeeAllowanceSchema,
  employeeCreateSchema,
  employeeDeductionSchema,
  employeeListQuery,
  employeeUpdateSchema,
  statusChangeSchema,
} from '@yardhrms/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { AnyPermission, Auth, Permissions, RequireFeature } from '../common/decorators';
import { CryptoService, last4, mask } from '../common/crypto.service';
import { badRequest, forbidden, notFound } from '../common/errors';
import { decOrNull, isoDay, toDate } from '../common/util';
import { ZBody, ZQuery } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EmployeesService } from './employees.service';

@ApiTags('Employees')
@RequireFeature(Features.EMPLOYEES)
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @Permissions(P.EMPLOYEES_READ)
  list(@Auth() a: AuthContext, @ZQuery(employeeListQuery) q: z.infer<typeof employeeListQuery>) {
    return this.employees.list(requireTenant(a), q);
  }

  /** Searchable active-employee selector for delegated leave/timesheet/overtime entry. */
  @Get('options')
  @AnyPermission(P.EMPLOYEES_READ, P.LEAVE_SUBMIT_ANY, P.TIMESHEETS_SUBMIT_ANY, P.OVERTIME_SUBMIT_ANY, P.PAYSLIPS_PRINT_ANY, P.USERS_MANAGE)
  options(@Auth() a: AuthContext, @Query('search') search?: string, @Query('eligibleFor') eligibleFor?: 'timesheet' | 'overtime') {
    return this.employees.options(requireTenant(a), search?.slice(0, 100), eligibleFor);
  }

  @Get('next-number')
  @Permissions(P.EMPLOYEES_WRITE)
  async nextNumber(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { nextEmployeeSeq: true } });
    let n = t.nextEmployeeSeq;
    for (;;) {
      const candidate = `EMP-${String(n).padStart(4, '0')}`;
      const exists = await this.prisma.employee.findUnique({ where: { tenantId_employeeNumber: { tenantId: auth.tenantId, employeeNumber: candidate } }, select: { id: true } });
      if (!exists) return { employeeNumber: candidate };
      n++;
    }
  }

  @Post()
  @Permissions(P.EMPLOYEES_WRITE)
  create(@Auth() a: AuthContext, @ZBody(employeeCreateSchema) body: z.infer<typeof employeeCreateSchema>) {
    const auth = requireTenant(a);
    if ((body.salaryPerPeriod || body.hourlyRate) && !auth.permissions.has(P.COMPENSATION_WRITE) && !auth.permissions.has(P.EMPLOYEES_WRITE)) throw forbidden();
    return this.employees.create(auth, body);
  }

  @Get(':id')
  async get(@Auth() a: AuthContext, @Param('id') id: string, @Query('reveal') reveal?: string) {
    const auth = requireTenant(a);
    if (!auth.permissions.has(P.EMPLOYEES_READ) && auth.employeeId !== id) throw notFound('Employee');
    const e = await this.employees.getOrThrow(auth.tenantId, id);
    const doReveal = reveal === 'true' && auth.permissions.has(P.EMPLOYEES_SENSITIVE_READ);
    if (doReveal) await this.audit.record({ tenantId: auth.tenantId, action: 'employee.identifiers_viewed', entityType: 'Employee', entityId: id, subjectEmployeeId: id });
    return this.employees.present(e, auth, { reveal: doReveal });
  }

  @Patch(':id')
  @Permissions(P.EMPLOYEES_WRITE)
  update(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(employeeUpdateSchema) body: z.infer<typeof employeeUpdateSchema>) {
    return this.employees.update(requireTenant(a), id, body);
  }

  @Post(':id/compensation')
  @Permissions(P.COMPENSATION_WRITE)
  @HttpCode(200)
  compensation(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(compensationChangeSchema) body: z.infer<typeof compensationChangeSchema>) {
    return this.employees.changeCompensation(requireTenant(a), id, body);
  }

  @Post(':id/deactivate')
  @Permissions(P.EMPLOYEES_WRITE)
  @HttpCode(200)
  deactivate(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(statusChangeSchema) body: z.infer<typeof statusChangeSchema>) {
    return this.employees.setStatus(requireTenant(a), id, 'deactivate', body.reason, body.effectiveDate, body.terminate);
  }

  @Post(':id/reactivate')
  @Permissions(P.EMPLOYEES_WRITE)
  @HttpCode(200)
  reactivate(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(statusChangeSchema) body: z.infer<typeof statusChangeSchema>) {
    return this.employees.setStatus(requireTenant(a), id, 'reactivate', body.reason);
  }

  @Delete(':id')
  @Permissions(P.EMPLOYEES_WRITE)
  @HttpCode(200)
  remove(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(z.object({ reason: z.string().trim().min(3).max(255) })) body: { reason: string }) {
    return this.employees.softDelete(requireTenant(a), id, body.reason);
  }

  // ── History ─────────────────────────────────────────────────────────────
  @Get(':id/compensation-history')
  @Permissions(P.COMPENSATION_READ)
  async compHistory(@Auth() a: AuthContext, @Param('id') id: string) {
    const auth = requireTenant(a);
    await this.employees.getOrThrow(auth.tenantId, id);
    const rows = await this.prisma.compensationHistory.findMany({ where: { tenantId: auth.tenantId, employeeId: id }, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }] });
    return rows.map((r) => ({ ...r, effectiveDate: isoDay(r.effectiveDate) }));
  }

  @Get(':id/history')
  async history(@Auth() a: AuthContext, @Param('id') id: string) {
    const auth = requireTenant(a);
    if (!auth.permissions.has(P.EMPLOYEES_READ) && auth.employeeId !== id) throw notFound('Employee');
    await this.employees.getOrThrow(auth.tenantId, id);
    const [events, audit] = await Promise.all([
      this.prisma.employmentHistory.findMany({ where: { tenantId: auth.tenantId, employeeId: id }, orderBy: { createdAt: 'desc' } }),
      auth.permissions.has(P.EMPLOYEES_WRITE)
        ? this.prisma.auditEvent.findMany({ where: { tenantId: auth.tenantId, subjectEmployeeId: id }, orderBy: { createdAt: 'desc' }, take: 100 })
        : Promise.resolve([]),
    ]);
    return { events: events.map((e) => ({ ...e, eventDate: isoDay(e.eventDate) })), audit };
  }

  // ── Bank accounts (encrypted; SEC-007) ──────────────────────────────────
  @Get(':id/bank-accounts')
  @AnyPermission(P.COMPENSATION_READ, P.EMPLOYEES_SENSITIVE_READ)
  async bankAccounts(@Auth() a: AuthContext, @Param('id') id: string, @Query('reveal') reveal?: string) {
    const auth = requireTenant(a);
    await this.employees.getOrThrow(auth.tenantId, id);
    const rows = await this.prisma.employeeBankAccount.findMany({ where: { tenantId: auth.tenantId, employeeId: id, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    const doReveal = reveal === 'true' && auth.permissions.has(P.EMPLOYEES_SENSITIVE_READ);
    if (doReveal) await this.audit.record({ tenantId: auth.tenantId, action: 'employee.bank_viewed', entityType: 'Employee', entityId: id, subjectEmployeeId: id });
    return rows.map(({ accountNumberEnc, ...r }) => ({ ...r, accountNumber: doReveal ? this.crypto.decryptNullable(accountNumberEnc) : mask(r.accountLast4) }));
  }

  @Post(':id/bank-accounts')
  @Permissions(P.COMPENSATION_WRITE)
  async addBank(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(bankAccountSchema) body: z.infer<typeof bankAccountSchema>) {
    const auth = requireTenant(a);
    await this.employees.getOrThrow(auth.tenantId, id);
    const created = await this.prisma.tx(async (tx) => {
      if (body.isPrimary) await tx.employeeBankAccount.updateMany({ where: { tenantId: auth.tenantId, employeeId: id }, data: { isPrimary: false } });
      const { accountNumber, ...rest } = body;
      const row = await tx.employeeBankAccount.create({
        data: { ...rest, tenantId: auth.tenantId, employeeId: id, accountNumberEnc: this.crypto.encrypt(accountNumber), accountLast4: last4(accountNumber)! },
      });
      await this.audit.record({ tenantId: auth.tenantId, action: 'employee.bank_added', entityType: 'EmployeeBankAccount', entityId: row.id, subjectEmployeeId: id, after: { bankName: body.bankName, last4: row.accountLast4 } }, tx);
      return row;
    });
    return { id: created.id };
  }

  @Delete(':id/bank-accounts/:accountId')
  @Permissions(P.COMPENSATION_WRITE)
  @HttpCode(200)
  async removeBank(@Auth() a: AuthContext, @Param('id') id: string, @Param('accountId') accountId: string) {
    const auth = requireTenant(a);
    const row = await this.prisma.employeeBankAccount.findFirst({ where: { id: accountId, employeeId: id, tenantId: auth.tenantId, deletedAt: null } });
    if (!row) throw notFound('Bank account');
    await this.prisma.employeeBankAccount.update({ where: { id: accountId }, data: { deletedAt: new Date(), isPrimary: false } });
    await this.audit.record({ tenantId: auth.tenantId, action: 'employee.bank_removed', entityType: 'EmployeeBankAccount', entityId: accountId, subjectEmployeeId: id });
    return { deleted: true };
  }

  // ── Emergency contacts ──────────────────────────────────────────────────
  @Get(':id/emergency-contacts')
  async contacts(@Auth() a: AuthContext, @Param('id') id: string) {
    const auth = requireTenant(a);
    if (!auth.permissions.has(P.EMPLOYEES_READ) && auth.employeeId !== id) throw notFound('Employee');
    await this.employees.getOrThrow(auth.tenantId, id);
    return this.prisma.employeeEmergencyContact.findMany({ where: { tenantId: auth.tenantId, employeeId: id }, orderBy: { createdAt: 'asc' } });
  }

  @Post(':id/emergency-contacts')
  @Permissions(P.EMPLOYEES_WRITE)
  async addContact(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(emergencyContactSchema) body: z.infer<typeof emergencyContactSchema>) {
    const auth = requireTenant(a);
    await this.employees.getOrThrow(auth.tenantId, id);
    const row = await this.prisma.employeeEmergencyContact.create({ data: { ...body, email: body.email ?? null, tenantId: auth.tenantId, employeeId: id } });
    await this.audit.record({ tenantId: auth.tenantId, action: 'employee.emergency_contact_added', entityType: 'EmployeeEmergencyContact', entityId: row.id, subjectEmployeeId: id, after: body });
    return row;
  }

  @Delete(':id/emergency-contacts/:contactId')
  @Permissions(P.EMPLOYEES_WRITE)
  @HttpCode(200)
  async removeContact(@Auth() a: AuthContext, @Param('id') id: string, @Param('contactId') contactId: string) {
    const auth = requireTenant(a);
    const res = await this.prisma.employeeEmergencyContact.deleteMany({ where: { id: contactId, employeeId: id, tenantId: auth.tenantId } });
    if (!res.count) throw notFound('Contact');
    await this.audit.record({ tenantId: auth.tenantId, action: 'employee.emergency_contact_removed', entityType: 'EmployeeEmergencyContact', entityId: contactId, subjectEmployeeId: id });
    return { deleted: true };
  }

  // ── Documents (private storage, NFR-007) ────────────────────────────────
  @Get(':id/documents')
  async documents(@Auth() a: AuthContext, @Param('id') id: string) {
    const auth = requireTenant(a);
    if (!auth.permissions.has(P.DOCUMENTS_MANAGE) && auth.employeeId !== id) throw notFound('Employee');
    await this.employees.getOrThrow(auth.tenantId, id);
    const rows = await this.prisma.employeeDocument.findMany({ where: { tenantId: auth.tenantId, employeeId: id, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    return rows.map(({ storageKey: _k, ...r }) => r);
  }

  @Post(':id/documents')
  @Permissions(P.DOCUMENTS_MANAGE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async upload(@Auth() a: AuthContext, @Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Body('category') category?: string) {
    const auth = requireTenant(a);
    await this.employees.getOrThrow(auth.tenantId, id);
    const type = this.storage.validateUpload(file, 'document');
    const key = this.storage.key(`tenants/${auth.tenantId}`, 'employees', id, file.originalname);
    await this.storage.put(key, file.buffer, type);
    const row = await this.prisma.employeeDocument.create({
      data: {
        tenantId: auth.tenantId,
        employeeId: id,
        category: (category ?? 'General').slice(0, 60),
        fileName: file.originalname.slice(0, 190),
        contentType: type,
        sizeBytes: file.size,
        sha256: this.crypto.sha256(file.buffer),
        storageKey: key,
        uploadedById: auth.user.id,
      },
    });
    await this.audit.record({ tenantId: auth.tenantId, action: 'employee.document_uploaded', entityType: 'EmployeeDocument', entityId: row.id, subjectEmployeeId: id, after: { fileName: row.fileName, category: row.category } });
    const { storageKey: _k, ...out } = row;
    return out;
  }

  @Get(':id/documents/:docId/download')
  async download(@Auth() a: AuthContext, @Param('id') id: string, @Param('docId') docId: string, @Res({ passthrough: true }) res: Response) {
    const auth = requireTenant(a);
    if (!auth.permissions.has(P.DOCUMENTS_MANAGE) && auth.employeeId !== id) throw notFound('Document');
    const doc = await this.prisma.employeeDocument.findFirst({ where: { id: docId, employeeId: id, tenantId: auth.tenantId, deletedAt: null } });
    if (!doc) throw notFound('Document');
    const buf = await this.storage.get(doc.storageKey);
    await this.audit.record({ tenantId: auth.tenantId, action: 'employee.document_downloaded', entityType: 'EmployeeDocument', entityId: doc.id, subjectEmployeeId: id });
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    return new StreamableFile(buf);
  }

  @Delete(':id/documents/:docId')
  @Permissions(P.DOCUMENTS_MANAGE)
  @HttpCode(200)
  async removeDoc(@Auth() a: AuthContext, @Param('id') id: string, @Param('docId') docId: string) {
    const auth = requireTenant(a);
    const res = await this.prisma.employeeDocument.updateMany({ where: { id: docId, employeeId: id, tenantId: auth.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!res.count) throw notFound('Document');
    await this.audit.record({ tenantId: auth.tenantId, action: 'employee.document_removed', entityType: 'EmployeeDocument', entityId: docId, subjectEmployeeId: id });
    return { deleted: true };
  }

  // ── Recurring allowances & deductions ───────────────────────────────────
  @Get(':id/pay-items')
  @Permissions(P.COMPENSATION_READ)
  async payItems(@Auth() a: AuthContext, @Param('id') id: string) {
    const auth = requireTenant(a);
    await this.employees.getOrThrow(auth.tenantId, id);
    const [allowances, deductions] = await Promise.all([
      this.prisma.employeeAllowance.findMany({ where: { tenantId: auth.tenantId, employeeId: id, deletedAt: null }, include: { allowanceType: true }, orderBy: { startDate: 'desc' } }),
      this.prisma.employeeDeduction.findMany({ where: { tenantId: auth.tenantId, employeeId: id, deletedAt: null }, include: { deductionType: true }, orderBy: { startDate: 'desc' } }),
    ]);
    const fmt = (r: any) => ({ ...r, startDate: isoDay(r.startDate), endDate: isoDay(r.endDate) });
    return { allowances: allowances.map(fmt), deductions: deductions.map(fmt) };
  }

  @Post(':id/allowances')
  @Permissions(P.COMPENSATION_WRITE)
  async addAllowance(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(employeeAllowanceSchema) body: z.infer<typeof employeeAllowanceSchema>) {
    const auth = requireTenant(a);
    await this.employees.getOrThrow(auth.tenantId, id);
    const type = await this.prisma.allowanceType.findFirst({ where: { id: body.allowanceTypeId, tenantId: auth.tenantId, active: true } });
    if (!type) throw badRequest('Allowance type not found');
    if (body.endDate && body.endDate < body.startDate) throw badRequest('End date must be after start date');
    const row = await this.prisma.employeeAllowance.create({
      data: { tenantId: auth.tenantId, employeeId: id, allowanceTypeId: type.id, amount: decOrNull(body.amount)!, startDate: toDate(body.startDate), endDate: toDate(body.endDate), createdById: auth.user.id },
    });
    await this.audit.record({ tenantId: auth.tenantId, action: 'employee.allowance_added', entityType: 'EmployeeAllowance', entityId: row.id, subjectEmployeeId: id, after: body });
    return row;
  }

  @Delete(':id/allowances/:itemId')
  @Permissions(P.COMPENSATION_WRITE)
  @HttpCode(200)
  async removeAllowance(@Auth() a: AuthContext, @Param('id') id: string, @Param('itemId') itemId: string) {
    const auth = requireTenant(a);
    const res = await this.prisma.employeeAllowance.updateMany({ where: { id: itemId, employeeId: id, tenantId: auth.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!res.count) throw notFound('Allowance');
    await this.audit.record({ tenantId: auth.tenantId, action: 'employee.allowance_removed', entityType: 'EmployeeAllowance', entityId: itemId, subjectEmployeeId: id });
    return { deleted: true };
  }

  @Post(':id/deductions')
  @Permissions(P.COMPENSATION_WRITE)
  async addDeduction(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(employeeDeductionSchema) body: z.infer<typeof employeeDeductionSchema>) {
    const auth = requireTenant(a);
    await this.employees.getOrThrow(auth.tenantId, id);
    const type = await this.prisma.deductionType.findFirst({ where: { id: body.deductionTypeId, tenantId: auth.tenantId, active: true } });
    if (!type) throw badRequest('Deduction type not found');
    if (body.endDate && body.endDate < body.startDate) throw badRequest('End date must be after start date');
    const row = await this.prisma.employeeDeduction.create({
      data: {
        tenantId: auth.tenantId,
        employeeId: id,
        deductionTypeId: type.id,
        amount: decOrNull(body.amount)!,
        startDate: toDate(body.startDate),
        endDate: toDate(body.endDate),
        reference: body.reference ?? null,
        balance: decOrNull(body.balance),
        createdById: auth.user.id,
      },
    });
    await this.audit.record({ tenantId: auth.tenantId, action: 'employee.deduction_added', entityType: 'EmployeeDeduction', entityId: row.id, subjectEmployeeId: id, after: body });
    return row;
  }

  @Delete(':id/deductions/:itemId')
  @Permissions(P.COMPENSATION_WRITE)
  @HttpCode(200)
  async removeDeduction(@Auth() a: AuthContext, @Param('id') id: string, @Param('itemId') itemId: string) {
    const auth = requireTenant(a);
    const res = await this.prisma.employeeDeduction.updateMany({ where: { id: itemId, employeeId: id, tenantId: auth.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!res.count) throw notFound('Deduction');
    await this.audit.record({ tenantId: auth.tenantId, action: 'employee.deduction_removed', entityType: 'EmployeeDeduction', entityId: itemId, subjectEmployeeId: id });
    return { deleted: true };
  }
}
