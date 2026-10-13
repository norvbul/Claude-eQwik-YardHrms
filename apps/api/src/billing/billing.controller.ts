import { Controller, Get, HttpCode, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformPermissions as PP, TenantPermissions as P } from '@yardhrms/authorization';
import { invoiceCreateSchema, invoiceVoidSchema } from '@yardhrms/types';
import type { Response } from 'express';
import { z } from 'zod';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { AllowReadOnly, Auth, Permissions, PlatformRoute } from '../common/decorators';
import { badRequest, notFound } from '../common/errors';
import { ZBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

const pdf = (res: Response, d: { buf: Buffer; name: string }) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${d.name}"`);
  res.setHeader('Cache-Control', 'no-store');
  return new StreamableFile(d.buf);
};
const isoDate = (v: string | undefined, name: string) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`${name} must be YYYY-MM-DD`);
  return v;
};

@ApiTags('Qwik Platform — Billing documents')
@PlatformRoute()
@Controller('platform')
export class PlatformBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  @Permissions(PP.PAYMENTS_READ)
  list(@Query('customerId') customerId?: string) {
    return this.billing.listInvoices({ customerId });
  }

  @Post('invoices')
  @Permissions(PP.PAYMENTS_RECORD)
  create(@Auth() a: AuthContext, @ZBody(invoiceCreateSchema) body: z.infer<typeof invoiceCreateSchema>) {
    return this.billing.createInvoice(a.user.id, body);
  }

  @Post('invoices/:id/void')
  @Permissions(PP.PAYMENTS_REVERSE)
  @HttpCode(200)
  void(@Auth() a: AuthContext, @Param('id') id: string, @ZBody(invoiceVoidSchema) body: z.infer<typeof invoiceVoidSchema>) {
    return this.billing.voidInvoice(a.user.id, id, body.reason);
  }

  @Get('invoices/:id/pdf')
  @Permissions(PP.PAYMENTS_READ)
  async invoicePdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    return pdf(res, await this.billing.invoicePdf(id));
  }

  @Get('payments/:id/receipt')
  @Permissions(PP.PAYMENTS_READ)
  async receipt(@Auth() a: AuthContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    return pdf(res, await this.billing.receiptPdf(id, a.user.id));
  }

  @Get('customers/:id/statement')
  @Permissions(PP.PAYMENTS_READ)
  async statement(@Param('id') id: string, @Query('from') from: string, @Query('to') to: string, @Res({ passthrough: true }) res: Response) {
    return pdf(res, await this.billing.statement(id, isoDate(from, 'from'), isoDate(to, 'to')));
  }
}

/** Tenant administrators see and download their own billing documents (read-only, also when expired). */
@ApiTags('Subscription')
@Controller('subscription/billing')
@AllowReadOnly()
export class TenantBillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Permissions(P.SUBSCRIPTION_READ)
  async documents(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    const invoices = await this.billing.listInvoices({ tenantId: auth.tenantId });
    const payments = await this.prisma.manualPayment.findMany({
      where: { customer: { tenantId: auth.tenantId }, status: { in: ['VERIFIED', 'REVERSED'] }, receipt: { isNot: null } },
      include: { receipt: true },
      orderBy: { paymentDate: 'desc' },
    });
    return {
      invoices: invoices.map(({ lines: _l, createdById: _c, ...i }) => i),
      receipts: payments.map((p) => ({ paymentId: p.id, number: p.receipt!.number, date: p.paymentDate.toISOString().slice(0, 10), amount: p.amount.toFixed(2), currency: p.currency, status: p.status })),
    };
  }

  @Get('invoices/:id/pdf')
  @Permissions(P.SUBSCRIPTION_READ)
  async invoicePdf(@Auth() a: AuthContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    return pdf(res, await this.billing.invoicePdf(id, { tenantId: requireTenant(a).tenantId }));
  }

  @Get('receipts/:paymentId/pdf')
  @Permissions(P.SUBSCRIPTION_READ)
  async receiptPdf(@Auth() a: AuthContext, @Param('paymentId') id: string, @Res({ passthrough: true }) res: Response) {
    return pdf(res, await this.billing.receiptPdf(id, null, { tenantId: requireTenant(a).tenantId }));
  }

  @Get('statement')
  @Permissions(P.SUBSCRIPTION_READ)
  async statement(@Auth() a: AuthContext, @Query('from') from: string, @Query('to') to: string, @Res({ passthrough: true }) res: Response) {
    const auth = requireTenant(a);
    const customer = await this.prisma.customer.findFirst({ where: { tenantId: auth.tenantId } });
    if (!customer) throw notFound('Billing account');
    return pdf(res, await this.billing.statement(customer.id, isoDate(from, 'from'), isoDate(to, 'to'), { tenantId: auth.tenantId }));
  }
}
