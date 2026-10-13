import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';

export interface MailMessage {
  to: string;
  subject: string;
  template: string;
  text: string;
  html?: string;
}

/** Outbound email. Uses SMTP when configured; otherwise logs (development only). Records delivery status. */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private transporter: Transporter | null = null;
  /** Last messages sent (in-memory, test/dev inspection only — never exposed via API). */
  readonly outbox: MailMessage[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    if (config.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465,
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
      });
    }
  }

  /** Returns the delivery status; failures are recorded, never thrown. */
  async send(msg: MailMessage): Promise<'SENT' | 'LOGGED' | 'CAPTURED' | 'FAILED'> {
    if (this.config.NODE_ENV !== 'production') {
      this.outbox.push(msg);
      if (this.outbox.length > 200) this.outbox.shift();
    }
    let status = 'SENT';
    let error: string | null = null;
    try {
      if (this.transporter) {
        await this.transporter.sendMail({ from: this.config.SMTP_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
      } else if (this.config.NODE_ENV === 'production') {
        throw new Error('SMTP is not configured');
      } else if (this.config.NODE_ENV === 'development') {
        status = 'LOGGED';
        this.logger.log(`\n──── EMAIL to ${msg.to} ────\nSubject: ${msg.subject}\n${msg.text}\n──────────────`);
      } else {
        status = 'CAPTURED';
      }
    } catch (e) {
      status = 'FAILED';
      error = (e as Error).message;
      this.logger.error(`Email to ${msg.to} failed: ${error}`);
    }
    await this.prisma.outboundEmail
      .create({ data: { toAddress: msg.to, subject: msg.subject.slice(0, 255), template: msg.template, status, error } })
      .catch(() => undefined);
    return status as 'SENT' | 'LOGGED' | 'CAPTURED' | 'FAILED';
  }

  layout(title: string, bodyLines: string[], action?: { label: string; url: string }): { text: string; html: string } {
    const text = [title, '', ...bodyLines, ...(action ? ['', `${action.label}: ${action.url}`] : []), '', '— eQwik YardHRMS™ by Qwik Business Solutions™'].join('\n');
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a">
<h2 style="color:#0b5d3b">${esc(title)}</h2>${bodyLines.map((l) => `<p>${esc(l)}</p>`).join('')}
${action ? `<p><a href="${esc(action.url)}" style="background:#0b5d3b;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(action.label)}</a></p>` : ''}
<p style="color:#64748b;font-size:12px">eQwik YardHRMS™ by Qwik Business Solutions™</p></body></html>`;
    return { text, html };
  }
}
