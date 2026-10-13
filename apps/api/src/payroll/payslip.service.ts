import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { TenantPermissions as P } from '@yardhrms/authorization';
import { AuditService } from '../audit/audit.service';
import type { TenantAuth } from '../auth/auth-context';
import { CryptoService } from '../common/crypto.service';
import { notFound } from '../common/errors';
import { RequestContext } from '../common/request-context';
import { isoDay, paginate } from '../common/util';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const BRAND = '#0b5d3b';

function fmt(v: Prisma.Decimal | string | number | null | undefined): string {
  const n = new Prisma.Decimal(v ?? 0);
  const neg = n.isNegative();
  const [i, f] = n.abs().toFixed(2).split('.');
  return `${neg ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`;
}

/** Payslip PDFs (PAY-009) with protected access and per-action audit (PAY-010, AC-10). */
@Injectable()
export class PayslipService implements OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register('payslips.generate', async (payload: { tenantId: string; runId: string }) => {
      const slips = await this.prisma.payslip.findMany({ where: { tenantId: payload.tenantId, runId: payload.runId, storageKey: null } });
      for (const s of slips) await this.ensurePdf(payload.tenantId, s.id);
      return { generated: slips.length };
    });
  }

  /** Access rule: own payslips (payslips.read.self) or any employee (payslips.print.any). Only APPROVED/LOCKED runs. */
  private async loadAuthorized(auth: TenantAuth, payslipId: string) {
    const slip = await this.prisma.payslip.findFirst({ where: { id: payslipId, tenantId: auth.tenantId }, include: { run: true } });
    if (!slip || !['APPROVED', 'LOCKED'].includes(slip.run.status)) throw notFound('Payslip');
    const own = auth.employeeId === slip.employeeId && auth.permissions.has(P.PAYSLIPS_READ_SELF);
    if (!own && !auth.permissions.has(P.PAYSLIPS_PRINT_ANY)) throw notFound('Payslip');
    return slip;
  }

  async list(auth: TenantAuth, q: { page: number; pageSize: number; employeeId?: string; year?: number }) {
    const canAny = auth.permissions.has(P.PAYSLIPS_PRINT_ANY);
    const employeeId = canAny ? q.employeeId : auth.employeeId;
    if (!employeeId && !canAny) return paginate([], 0, q.page, q.pageSize);
    const where: Prisma.PayslipWhereInput = { tenantId: auth.tenantId, run: { status: { in: ['APPROVED', 'LOCKED'] } } };
    if (employeeId) where.employeeId = employeeId;
    if (q.year) where.payDate = { gte: new Date(Date.UTC(q.year, 0, 1)), lte: new Date(Date.UTC(q.year, 11, 31)) };
    const [total, rows] = await Promise.all([
      this.prisma.payslip.count({ where }),
      this.prisma.payslip.findMany({
        where,
        include: { runEmployee: { select: { employeeName: true, employeeNumber: true, grossPay: true, netPay: true, departmentName: true } }, run: { select: { runNumber: true, frequency: true, runType: true, period: true } } },
        orderBy: [{ payDate: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return paginate(
      rows.map((s) => ({
        id: s.id,
        employeeId: s.employeeId,
        employeeName: s.runEmployee.employeeName,
        employeeNumber: s.runEmployee.employeeNumber,
        departmentName: s.runEmployee.departmentName,
        payDate: isoDay(s.payDate),
        periodStart: isoDay(s.run.period.periodStart),
        periodEnd: isoDay(s.run.period.periodEnd),
        runNumber: s.run.runNumber,
        runType: s.run.runType,
        frequency: s.run.frequency,
        grossPay: s.runEmployee.grossPay.toString(),
        netPay: s.runEmployee.netPay.toString(),
        generated: !!s.generatedAt,
      })),
      total,
      q.page,
      q.pageSize,
    );
  }

  async recordAccess(auth: TenantAuth, payslipId: string, action: 'VIEW' | 'DOWNLOAD' | 'PRINT') {
    const slip = await this.loadAuthorized(auth, payslipId);
    await this.prisma.payslipAccessEvent.create({ data: { tenantId: auth.tenantId, payslipId: slip.id, employeeId: slip.employeeId, userId: auth.user.id, action, ip: RequestContext.get()?.ip?.slice(0, 64) } });
    await this.audit.record({ tenantId: auth.tenantId, action: `payslip.${action.toLowerCase()}`, entityType: 'Payslip', entityId: slip.id, subjectEmployeeId: slip.employeeId, metadata: { delegated: slip.employeeId !== auth.employeeId } });
    return slip;
  }

  async download(auth: TenantAuth, payslipId: string, action: 'VIEW' | 'DOWNLOAD') {
    const slip = await this.recordAccess(auth, payslipId, action);
    const key = await this.ensurePdf(auth.tenantId, slip.id);
    const buf = await this.storage.get(key);
    return { buf, fileName: `payslip-${slip.employeeId.slice(0, 8)}-${isoDay(slip.payDate)}.pdf` };
  }

  async accessLog(auth: TenantAuth, payslipId: string) {
    await this.loadAuthorized(auth, payslipId);
    const rows = await this.prisma.payslipAccessEvent.findMany({ where: { tenantId: auth.tenantId, payslipId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, fullName: true, email: true } });
    return rows.map((r) => ({ ...r, user: users.find((u) => u.id === r.userId) }));
  }

  /** Generates (once) and stores the immutable payslip PDF from the approved snapshot. */
  async ensurePdf(tenantId: string, payslipId: string): Promise<string> {
    const slip = await this.prisma.payslip.findFirstOrThrow({
      where: { id: payslipId, tenantId },
      include: { runEmployee: { include: { earnings: true, deductions: true } }, run: { include: { period: true } } },
    });
    if (slip.storageKey && (await this.storage.exists(slip.storageKey))) return slip.storageKey;
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const re = slip.runEmployee;
    const yearStart = new Date(Date.UTC(slip.payDate.getUTCFullYear(), 0, 1));
    const ytdRows = await this.prisma.payrollRunEmployee.findMany({
      where: { tenantId, employeeId: slip.employeeId, run: { status: { in: ['APPROVED', 'LOCKED'] }, period: { payDate: { gte: yearStart, lte: slip.payDate } } } },
      include: { deductions: true },
    });
    const ytd = {
      gross: ytdRows.reduce((a, r) => a.plus(r.grossPay), new Prisma.Decimal(0)),
      net: ytdRows.reduce((a, r) => a.plus(r.netPay), new Prisma.Decimal(0)),
      byCode: new Map<string, Prisma.Decimal>(),
    };
    for (const r of ytdRows) for (const d of r.deductions.filter((x) => x.statutory)) ytd.byCode.set(d.code, (ytd.byCode.get(d.code) ?? new Prisma.Decimal(0)).plus(d.employeeAmount));

    let logo: Buffer | null = null;
    if (tenant.logoKey) logo = await this.storage.get(tenant.logoKey).catch(() => null);
    const certified = this.config.PAYROLL_COMPLIANCE_CERTIFIED && slip.run.ruleVersionApproved;

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Payslip ${re.employeeName} ${isoDay(slip.payDate)}`, Author: tenant.displayName, Creator: 'eQwik YardHRMS' } });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const W = doc.page.width - 80;

      doc.rect(40, 40, W, 70).fill(BRAND);
      if (logo) {
        try {
          doc.image(logo, 50, 48, { fit: [54, 54] });
        } catch {
          /* unsupported image */
        }
      }
      const tx = logo ? 115 : 55;
      doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold').text(tenant.displayName, tx, 52, { width: W - 200 });
      doc.fontSize(9).font('Helvetica').text(tenant.legalName, tx, 72, { width: W - 200 });
      if (tenant.addressLine1) doc.text([tenant.addressLine1, tenant.city, tenant.parish].filter(Boolean).join(', '), tx, 85, { width: W - 200 });
      doc.fontSize(18).font('Helvetica-Bold').text('PAYSLIP', 40, 55, { width: W - 15, align: 'right' });
      doc.fontSize(9).font('Helvetica').text(`Pay date: ${isoDay(slip.payDate)}`, 40, 80, { width: W - 15, align: 'right' });

      let y = 122;
      if (!certified) {
        doc.rect(40, y, W, 30).fill('#fef3c7');
        doc.fillColor('#92400e').fontSize(8.5).font('Helvetica-Bold').text('NOT CERTIFIED FOR LIVE PAYROLL', 50, y + 5);
        doc.font('Helvetica').text('Statutory deduction rules have not completed compliance certification. Figures must be verified by a qualified Jamaican payroll specialist.', 50, y + 16, { width: W - 20 });
        y += 38;
      }
      if (slip.run.runType !== 'REGULAR') {
        doc.fillColor('#1e3a8a').fontSize(9).font('Helvetica-Bold').text(`${slip.run.runType} RUN ${slip.run.runNumber}`, 40, y);
        y += 14;
      }

      doc.fillColor('#0f172a').fontSize(9).font('Helvetica');
      const info: [string, string][] = [
        ['Employee', `${re.employeeName} (${re.employeeNumber})`],
        ['Department', re.departmentName ?? '—'],
        ['Position', re.positionName ?? '—'],
        ['Pay period', `${isoDay(slip.run.period.periodStart)} to ${isoDay(slip.run.period.periodEnd)} (${re.payFrequency.toLowerCase()})`],
        ['TRN', re.trnMasked ?? '—'],
        ['NIS', re.nisMasked ?? '—'],
        ['Bank', re.bankName ? `${re.bankName} •••• ${re.bankAccountLast4}` : '—'],
        ['Pay basis', re.payType === 'SALARY' ? `Salary (hourly equivalent ${fmt(re.hourlyEquivalent)})` : `Hourly (${fmt(re.regularHours)} regular hrs)`],
      ];
      info.forEach(([k, v], i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        doc.font('Helvetica-Bold').text(k, 40 + col * (W / 2), y + row * 15, { width: 70 });
        doc.font('Helvetica').text(v, 112 + col * (W / 2), y + row * 15, { width: W / 2 - 80 });
      });
      y += Math.ceil(info.length / 2) * 15 + 12;

      const table = (title: string, rows: [string, string, string][], total: [string, string]) => {
        doc.rect(40, y, W, 18).fill('#e2e8f0');
        doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9).text(title, 46, y + 5);
        doc.text('Details', 300, y + 5, { width: 120, align: 'right' });
        doc.text('Amount (JMD)', 420, y + 5, { width: W - 386, align: 'right' });
        y += 22;
        doc.font('Helvetica').fontSize(9);
        for (const [label, det, amt] of rows) {
          doc.text(label, 46, y, { width: 250 });
          doc.text(det, 300, y, { width: 120, align: 'right' });
          doc.text(amt, 420, y, { width: W - 386, align: 'right' });
          y += 14;
        }
        doc.moveTo(40, y).lineTo(40 + W, y).strokeColor('#cbd5e1').stroke();
        y += 4;
        doc.font('Helvetica-Bold').text(total[0], 46, y);
        doc.text(total[1], 420, y, { width: W - 386, align: 'right' });
        y += 20;
      };

      table(
        'Earnings',
        re.earnings.map((e) => [e.description, e.quantity ? `${e.quantity.toString()} × ${fmt(e.rate)}` : e.taxable ? '' : 'non-taxable', fmt(e.amount)]),
        ['Gross pay', fmt(re.grossPay)],
      );
      const stat = re.deductions.filter((d) => d.statutory);
      const vol = re.deductions.filter((d) => !d.statutory);
      table(
        'Deductions',
        [...stat.map((d) => [d.description, d.code, fmt(d.employeeAmount)] as [string, string, string]), ...vol.map((d) => [d.description, d.category, fmt(d.employeeAmount)] as [string, string, string])],
        ['Total deductions', fmt(re.totalDeductions)],
      );

      doc.rect(40, y, W, 30).fill(BRAND);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13).text('NET PAY', 50, y + 9);
      doc.text(`JMD ${fmt(re.netPay)}`, 40, y + 9, { width: W - 10, align: 'right' });
      y += 42;

      doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text('Employer contributions (not deducted from pay)', 40, y);
      y += 13;
      doc.font('Helvetica');
      for (const d of stat.filter((s) => !s.employerAmount.isZero())) {
        doc.text(d.description, 46, y, { width: 300 });
        doc.text(fmt(d.employerAmount), 420, y, { width: W - 386, align: 'right' });
        y += 13;
      }
      y += 8;
      doc.font('Helvetica-Bold').text('Year to date', 40, y);
      y += 13;
      doc.font('Helvetica').text(`Gross ${fmt(ytd.gross)}   ·   Net ${fmt(ytd.net)}   ·   ${[...ytd.byCode.entries()].map(([k, v]) => `${k} ${fmt(v)}`).join('   ·   ')}`, 46, y, { width: W - 12 });

      doc.fontSize(7).fillColor('#64748b').text(
        `Rule version: ${(re.calculation as any)?.ruleVersionName ?? slip.run.ruleVersionId ?? '—'}  ·  Run ${slip.run.runNumber}  ·  Snapshot ${slip.run.snapshotHash?.slice(0, 12) ?? ''}\nConfidential. Generated by eQwik YardHRMS™ — Qwik Business Solutions™.`,
        40,
        doc.page.height - 70,
        { width: W, align: 'center' },
      );
      doc.end();
    });

    const key = this.storage.key(`tenants/${tenantId}`, 'payslips', slip.runId, `${slip.id}.pdf`);
    await this.storage.put(key, pdf, 'application/pdf');
    await this.prisma.payslip.update({ where: { id: slip.id }, data: { storageKey: key, sha256: this.crypto.sha256(pdf), generatedAt: new Date() } });
    return key;
  }
}
