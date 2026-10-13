import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { invoiceCreateSchema } from '@yardhrms/types';
import { AuditService } from '../audit/audit.service';
import { badRequest, businessRule, invalidState, notFound } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { fmtMoney, renderBillingPdf, type Party } from './billing-pdf';

const D = Prisma.Decimal;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
type Line = { description: string; quantity: string; unitPrice: string; amount: string };

/**
 * LIC-014: invoices, receipts and customer statements for manual payments. Documents are numbered
 * gap-free per series and year; content is immutable once issued (invoices can only be voided), and PDFs
 * are rendered from the stored record so a re-download always matches the original.
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private seller(): Party {
    const c = this.config;
    return {
      name: c.BILLING_SELLER_NAME,
      lines: [c.BILLING_SELLER_ADDRESS, c.BILLING_SELLER_EMAIL, c.BILLING_SELLER_TRN ? `TRN ${c.BILLING_SELLER_TRN}` : '', c.BILLING_GCT_NUMBER ? `GCT Reg. ${c.BILLING_GCT_NUMBER}` : ''],
    };
  }

  /** Gap-free numbering: INV-2026-00001. Row lock serialises concurrent issuers. */
  async nextNumber(tx: Tx, series: 'INV' | 'RCT', at = new Date()): Promise<string> {
    const key = `${series}-${at.getUTCFullYear()}`;
    await tx.$executeRaw`INSERT IGNORE INTO document_sequences (\`key\`, next, updated_at) VALUES (${key}, 1, NOW(3))`;
    const rows = await tx.$queryRaw<{ next: number }[]>`SELECT next FROM document_sequences WHERE \`key\` = ${key} FOR UPDATE`;
    const n = Number(rows[0].next);
    await tx.$executeRaw`UPDATE document_sequences SET next = next + 1, updated_at = NOW(3) WHERE \`key\` = ${key}`;
    return `${key}-${String(n).padStart(5, '0')}`;
  }

  async createInvoice(actorUserId: string, input: z.infer<typeof invoiceCreateSchema>) {
    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw notFound('Customer');
    const plan = input.planId ? await this.prisma.plan.findUnique({ where: { id: input.planId } }) : null;
    if (input.planId && !plan) throw notFound('Plan');
    let lines: Line[] = input.lines.map((l) => {
      const q = new D(l.quantity);
      const u = new D(l.unitPrice);
      return { description: l.description, quantity: q.toString(), unitPrice: u.toFixed(2), amount: q.times(u).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2) };
    });
    if (!lines.length && plan) {
      if (plan.isFree) throw businessRule('The Free plan is not invoiced');
      if (!plan.price) throw businessRule(`Set a price for the ${plan.name} plan before invoicing it, or enter invoice lines`);
      const months = plan.durationMonths ?? 12;
      lines = [{ description: `eQwik YardHRMS ${plan.name} subscription — ${months} month${months === 1 ? '' : 's'} (up to ${plan.employeeLimit} employees, ${plan.userLimit} users)`, quantity: '1', unitPrice: plan.price.toFixed(2), amount: plan.price.toFixed(2) }];
    }
    const currency = plan?.currency ?? 'JMD';
    const subtotal = lines.reduce((a, l) => a.plus(l.amount), new D(0));
    const taxRate = new D(this.config.BILLING_GCT_RATE);
    const taxAmount = subtotal.times(taxRate).toDecimalPlaces(2, D.ROUND_HALF_UP);
    const issue = input.issueDate ? new Date(`${input.issueDate}T00:00:00Z`) : new Date(`${day(new Date())}T00:00:00Z`);
    const due = new Date(issue.getTime() + (input.dueDays ?? this.config.BILLING_INVOICE_DUE_DAYS) * 86_400_000);
    const inv = await this.prisma.tx(async (tx) => {
      const number = await this.nextNumber(tx, 'INV', issue);
      const row = await tx.invoice.create({
        data: {
          number,
          customerId: customer.id,
          subscriptionId: input.subscriptionId ?? null,
          planId: plan?.id ?? null,
          issueDate: issue,
          dueDate: due,
          currency,
          lines,
          subtotal,
          taxRate,
          taxAmount,
          total: subtotal.plus(taxAmount),
          notes: input.notes ?? null,
          createdById: actorUserId,
        },
      });
      await this.audit.record({ scope: 'PLATFORM', tenantId: customer.tenantId, action: 'billing.invoice_issued', entityType: 'Invoice', entityId: row.id, after: { number, total: row.total.toFixed(2), currency }, actorUserId }, tx);
      return row;
    });
    return this.present(inv);
  }

  present(i: Prisma.InvoiceGetPayload<object>) {
    return { ...i, issueDate: day(i.issueDate), dueDate: day(i.dueDate), subtotal: i.subtotal.toFixed(2), taxRate: i.taxRate.toString(), taxAmount: i.taxAmount.toFixed(2), total: i.total.toFixed(2) };
  }

  async listInvoices(q: { customerId?: string; tenantId?: string }) {
    const rows = await this.prisma.invoice.findMany({
      where: { ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.tenantId ? { customer: { tenantId: q.tenantId } } : {}) },
      include: { customer: { select: { name: true } } },
      orderBy: { issueDate: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ ...this.present(r), customerName: r.customer.name }));
  }

  async voidInvoice(actorUserId: string, id: string, reason: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, include: { customer: true } });
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'ISSUED') throw invalidState(`A ${inv.status.toLowerCase()} invoice cannot be voided`);
    await this.prisma.invoice.update({ where: { id }, data: { status: 'VOID', voidReason: reason } });
    await this.audit.record({ scope: 'PLATFORM', tenantId: inv.customer.tenantId, action: 'billing.invoice_voided', entityType: 'Invoice', entityId: id, reason, actorUserId });
    return { voided: true };
  }

  /** Called when a payment becomes VERIFIED or REVERSED: links it to its invoice and settles the status. */
  async reconcilePayment(tx: Tx, paymentId: string) {
    const p = await tx.manualPayment.findUniqueOrThrow({ where: { id: paymentId } });
    let invoiceId = p.invoiceId;
    if (!invoiceId && p.invoiceNumber) {
      const inv = await tx.invoice.findFirst({ where: { number: p.invoiceNumber.trim().toUpperCase(), customerId: p.customerId } });
      if (inv) {
        invoiceId = inv.id;
        await tx.manualPayment.update({ where: { id: p.id }, data: { invoiceId } });
      }
    }
    if (!invoiceId) return;
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (inv.status === 'VOID') return;
    const paid = (await tx.manualPayment.findMany({ where: { invoiceId, status: 'VERIFIED' } })).reduce((a, x) => a.plus(x.amount), new D(0));
    const status = paid.greaterThanOrEqualTo(inv.total) ? 'PAID' : 'ISSUED';
    if (status !== inv.status) await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
  }

  async invoicePdf(id: string, scope?: { tenantId: string }): Promise<{ buf: Buffer; name: string }> {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, include: { customer: true, payments: { where: { status: 'VERIFIED' } } } });
    if (!inv || (scope && inv.customer.tenantId !== scope.tenantId)) throw notFound('Invoice');
    const lines = inv.lines as Line[];
    const paid = inv.payments.reduce((a, x) => a.plus(x.amount), new D(0));
    const gct = !inv.taxRate.isZero();
    const buf = await renderBillingPdf({
      title: 'INVOICE',
      number: inv.number,
      meta: [
        ['Issue date', day(inv.issueDate)],
        ['Due date', day(inv.dueDate)],
        ['Currency', inv.currency],
        ['Status', inv.status],
      ],
      seller: this.seller(),
      customer: { name: inv.customer.name, lines: [inv.customer.contactName ?? '', inv.customer.address ?? '', inv.customer.email ?? '', inv.customer.trn ? `TRN ${inv.customer.trn}` : ''] },
      columns: 'invoice',
      lines,
      totals: [
        ['Subtotal', fmtMoney(inv.currency, inv.subtotal.toFixed(2))],
        ...(gct ? ([[`GCT ${inv.taxRate.times(100).toString()}%`, fmtMoney(inv.currency, inv.taxAmount.toFixed(2))]] as [string, string][]) : []),
        ['Total', fmtMoney(inv.currency, inv.total.toFixed(2)), true],
        ['Paid', fmtMoney(inv.currency, paid.toFixed(2))],
        ['Balance due', fmtMoney(inv.currency, D.max(new D(0), inv.total.minus(paid)).toFixed(2)), true],
      ],
      notes: [this.config.BILLING_PAYMENT_INSTRUCTIONS, `Please quote ${inv.number} as your payment reference.`, ...(inv.notes ? [inv.notes] : []), ...(inv.status === 'VOID' ? [`Voided: ${inv.voidReason}`] : []), gct ? '' : 'GCT not charged.'].filter(Boolean),
      stamp: inv.status === 'VOID' ? { text: 'VOID', color: '#b91c1c' } : inv.status === 'PAID' ? { text: 'PAID', color: '#15803d' } : undefined,
    });
    return { buf, name: `${inv.number}.pdf` };
  }

  /** Receipts exist only for verified payments; a later reversal is shown on the document. */
  async receiptPdf(paymentId: string, actorUserId: string | null, scope?: { tenantId: string }): Promise<{ buf: Buffer; name: string }> {
    const p = await this.prisma.manualPayment.findUnique({ where: { id: paymentId }, include: { customer: true, receipt: true, invoice: true, history: { orderBy: { createdAt: 'desc' } } } });
    if (!p || (scope && p.customer.tenantId !== scope.tenantId)) throw notFound('Payment');
    if (!p.receipt && p.status !== 'VERIFIED') throw businessRule('A receipt is issued only for verified payments');
    let receipt = p.receipt;
    if (!receipt) {
      if (!actorUserId) throw badRequest('Receipt not yet issued');
      receipt = await this.prisma.tx(async (tx) => {
        const number = await this.nextNumber(tx, 'RCT', p.verifiedAt ?? new Date());
        const r = await tx.receipt.create({ data: { number, paymentId: p.id, issuedAt: p.verifiedAt ?? new Date(), createdById: actorUserId } });
        await this.audit.record({ scope: 'PLATFORM', tenantId: p.customer.tenantId, action: 'billing.receipt_issued', entityType: 'Receipt', entityId: r.id, after: { number, amount: p.amount.toFixed(2) }, actorUserId }, tx);
        return r;
      });
    }
    const reversed = p.status === 'REVERSED';
    const buf = await renderBillingPdf({
      title: 'RECEIPT',
      number: receipt.number,
      meta: [
        ['Receipt date', day(receipt.issuedAt)],
        ['Payment date', day(p.paymentDate)],
        ['Method', p.method.replace('_', ' ').toLowerCase()],
        ['Reference', p.reference],
        ...(p.invoice ? ([['Invoice', p.invoice.number]] as [string, string][]) : p.invoiceNumber ? ([['Invoice', p.invoiceNumber]] as [string, string][]) : []),
      ],
      seller: this.seller(),
      customer: { name: p.customer.name, lines: [p.customer.contactName ?? '', p.customer.address ?? '', p.customer.email ?? ''] },
      columns: 'invoice',
      lines: [
        {
          description: `Payment received${p.periodStart ? ` for the period ${day(p.periodStart)} to ${day(p.periodEnd)}` : ''}${p.invoice ? ` against invoice ${p.invoice.number}` : ''}`,
          amount: p.amount.toFixed(2),
        },
      ],
      totals: [['Amount received', fmtMoney(p.currency, p.amount.toFixed(2)), true]],
      notes: [reversed ? `This payment was reversed on ${day(p.history.find((h) => h.toStatus === 'REVERSED')?.createdAt)}; this receipt is no longer valid.` : 'Thank you for your payment.'],
      stamp: reversed ? { text: 'REVERSED', color: '#b91c1c' } : undefined,
    });
    return { buf, name: `${receipt.number}.pdf` };
  }

  async statement(customerId: string, from: string, to: string, scope?: { tenantId: string }) {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!c || (scope && c.tenantId !== scope.tenantId)) throw notFound('Customer');
    const f = new Date(`${from}T00:00:00Z`);
    const t = new Date(`${to}T23:59:59Z`);
    if (!(f <= t)) throw badRequest('Statement period is invalid');
    const invoices = await this.prisma.invoice.findMany({ where: { customerId, status: { not: 'VOID' } } });
    const payments = await this.prisma.manualPayment.findMany({ where: { customerId, status: { in: ['VERIFIED', 'REVERSED'] } }, include: { history: true } });
    type Ev = { date: Date; description: string; debit: Prisma.Decimal; credit: Prisma.Decimal };
    const events: Ev[] = [];
    for (const i of invoices) events.push({ date: i.issueDate, description: `Invoice ${i.number}`, debit: i.total, credit: new D(0) });
    for (const p of payments) {
      events.push({ date: p.paymentDate, description: `Payment ${p.reference} (${p.method.replace('_', ' ').toLowerCase()})`, debit: new D(0), credit: p.amount });
      const rev = p.history.find((h) => h.toStatus === 'REVERSED');
      if (rev) events.push({ date: rev.createdAt, description: `Reversal of payment ${p.reference}`, debit: p.amount, credit: new D(0) });
    }
    events.sort((a, b) => a.date.getTime() - b.date.getTime());
    let balance = new D(0);
    for (const e of events.filter((e) => e.date < f)) balance = balance.plus(e.debit).minus(e.credit);
    const opening = balance;
    const rows = events
      .filter((e) => e.date >= f && e.date <= t)
      .map((e) => {
        balance = balance.plus(e.debit).minus(e.credit);
        return { date: day(e.date), description: e.description, debit: e.debit.isZero() ? '' : e.debit.toFixed(2), credit: e.credit.isZero() ? '' : e.credit.toFixed(2), balance: balance.toFixed(2) };
      });
    const currency = 'JMD';
    const buf = await renderBillingPdf({
      title: 'STATEMENT',
      meta: [
        ['Period', `${from} to ${to}`],
        ['Opening balance', fmtMoney(currency, opening.toFixed(2))],
        ['Closing balance', fmtMoney(currency, balance.toFixed(2))],
      ],
      seller: this.seller(),
      customer: { name: c.name, lines: [c.contactName ?? '', c.address ?? '', c.email ?? ''] },
      columns: 'statement',
      lines: [],
      statementRows: [{ date: from, description: 'Opening balance', debit: '', credit: '', balance: opening.toFixed(2) }, ...rows],
      totals: [[balance.isNegative() ? 'Credit balance' : 'Amount due', fmtMoney(currency, balance.abs().toFixed(2)), true]],
      notes: [this.config.BILLING_PAYMENT_INSTRUCTIONS],
    });
    return { buf, name: `statement-${c.name.replace(/[^A-Za-z0-9]+/g, '-')}-${to}.pdf`, opening: opening.toFixed(2), closing: balance.toFixed(2), rows };
  }
}
