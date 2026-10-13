import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '@yardhrms/types';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { JobsService } from '../jobs/jobs.service';
import { MailService } from '../mail/mail.service';
import { PrismaService, Tx } from '../prisma/prisma.service';

export interface NotifyInput {
  tenantId: string | null;
  userIds: (string | null | undefined)[];
  category: NotificationCategory;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  /** Same key + same user never notifies twice (reminders). */
  dedupeKey?: string;
  /** The person who caused the event is never notified about their own action. */
  excludeUserId?: string | null;
}

/**
 * NFR-012: in-app notifications with email delivery. Rows are written inside the caller's transaction
 * (so a rolled-back action notifies nobody); emails are sent afterwards by the durable job queue, which
 * retries failures and honours each user's email preferences.
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger('Notifications');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register('notifications.deliver', () => this.deliverPending());
  }

  async notify(client: Tx | PrismaService, n: NotifyInput): Promise<number> {
    const ids = [...new Set(n.userIds.filter((u): u is string => !!u && u !== n.excludeUserId))];
    if (!ids.length) return 0;
    const res = await client.notification.createMany({
      data: ids.map((userId) => ({
        tenantId: n.tenantId,
        userId,
        category: n.category,
        type: n.type,
        title: n.title.slice(0, 190),
        body: n.body.slice(0, 1000),
        link: n.link ?? null,
        dedupeKey: n.dedupeKey ? n.dedupeKey.slice(0, 160) : null,
      })),
      skipDuplicates: true,
    });
    // Delivered shortly after the surrounding transaction commits; the periodic sweep is the safety net.
    await this.jobs.enqueue('notifications.deliver', {}, { runAt: new Date(Date.now() + 2000) }).catch((e) => this.logger.warn(e.message));
    return res.count;
  }

  /** Users with an ACTIVE membership in the tenant whose roles grant `permission`. */
  async usersWithPermission(client: Tx | PrismaService, tenantId: string, permission: string): Promise<string[]> {
    const rows = await client.tenantMembership.findMany({
      where: { tenantId, status: 'ACTIVE', roles: { some: { role: { permissions: { some: { permissionCode: permission } } } } } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /** The user linked to an employee record (self-service account), if any. */
  async userForEmployee(client: Tx | PrismaService, tenantId: string, employeeId: string): Promise<string | null> {
    const m = await client.tenantMembership.findFirst({ where: { tenantId, employeeId, status: 'ACTIVE' }, select: { userId: true } });
    return m?.userId ?? null;
  }

  /** A leave/timesheet/overtime record is waiting for approval: tell everyone who may approve it. */
  async requestSubmitted(
    client: Tx | PrismaService,
    a: { tenantId: string; actorUserId: string; actorName: string },
    r: { kind: 'leave' | 'timesheet' | 'overtime'; approvePermission: string; employeeId: string; employeeName: string; summary: string; link: string; id: string },
  ) {
    const approvers = await this.usersWithPermission(client, a.tenantId, r.approvePermission);
    const subjectUser = await this.userForEmployee(client, a.tenantId, r.employeeId);
    const label = r.kind === 'leave' ? 'Leave request' : r.kind === 'timesheet' ? 'Timesheet' : 'Overtime request';
    await this.notify(client, {
      tenantId: a.tenantId,
      userIds: approvers.filter((u) => u !== subjectUser),
      excludeUserId: a.actorUserId,
      category: 'approvals',
      type: `${r.kind}_submitted`,
      title: `${label} awaiting approval: ${r.employeeName}`,
      body: `${r.summary}. Submitted by ${a.actorName}.`,
      link: r.link,
      dedupeKey: `${r.kind}:${r.id}:submitted`,
    });
  }

  /** A request was approved or rejected: tell the employee concerned and whoever submitted it. */
  async requestDecided(
    client: Tx | PrismaService,
    a: { tenantId: string; actorUserId: string; actorName: string },
    r: { kind: 'leave' | 'timesheet' | 'overtime'; employeeId: string; submittedByUserId: string; status: 'APPROVED' | 'REJECTED'; summary: string; comment?: string | null; link: string; id: string },
  ) {
    const subjectUser = await this.userForEmployee(client, a.tenantId, r.employeeId);
    const label = r.kind === 'leave' ? 'Leave request' : r.kind === 'timesheet' ? 'Timesheet' : 'Overtime request';
    await this.notify(client, {
      tenantId: a.tenantId,
      userIds: [subjectUser, r.submittedByUserId],
      excludeUserId: a.actorUserId,
      category: 'decisions',
      type: `${r.kind}_${r.status.toLowerCase()}`,
      title: `${label} ${r.status === 'APPROVED' ? 'approved' : 'rejected'}`,
      body: `${r.summary} was ${r.status.toLowerCase()} by ${a.actorName}.${r.comment ? ` Comment: “${r.comment}”` : ''}`,
      link: r.link,
      dedupeKey: `${r.kind}:${r.id}:${r.status}`,
    });
  }

  /** Sends pending emails (batch). Returns counts for job logging. */
  async deliverPending(limit = 200): Promise<{ sent: number; skipped: number; failed: number }> {
    const rows = await this.prisma.notification.findMany({
      where: { emailStatus: 'PENDING' },
      include: { user: { select: { email: true, status: true, notificationPreferences: true } } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const tenantNames = new Map<string, string>();
    for (const n of rows) {
      const mandatory = NOTIFICATION_CATEGORIES.find((c) => c.key === n.category)?.mandatory ?? false;
      const pref = n.user.notificationPreferences.find((p) => p.category === n.category);
      if (n.user.status !== 'ACTIVE' || (!mandatory && pref && !pref.email)) {
        await this.prisma.notification.update({ where: { id: n.id }, data: { emailStatus: 'SKIPPED' } });
        skipped++;
        continue;
      }
      let org = '';
      if (n.tenantId) {
        if (!tenantNames.has(n.tenantId)) tenantNames.set(n.tenantId, (await this.prisma.tenant.findUnique({ where: { id: n.tenantId }, select: { displayName: true } }))?.displayName ?? '');
        org = tenantNames.get(n.tenantId)!;
      }
      try {
        const { text, html } = this.mail.layout(n.title, [n.body, org ? `Organization: ${org}` : '', 'You can change which emails you receive under Account & security → Notifications.'].filter(Boolean), n.link ? { label: 'Open in eQwik YardHRMS', url: `${this.config.HRMS_WEB_URL}${n.link}` } : undefined);
        const status = await this.mail.send({ to: n.user.email, subject: `${org ? `${org}: ` : ''}${n.title}`, template: `notify_${n.type}`, text, html });
        if (status === 'FAILED') throw new Error('mail transport failed');
        await this.prisma.notification.update({ where: { id: n.id }, data: { emailStatus: 'SENT', emailedAt: new Date() } });
        sent++;
      } catch (e) {
        await this.prisma.notification.update({ where: { id: n.id }, data: { emailStatus: 'FAILED' } });
        this.logger.warn(`Notification ${n.id} email failed: ${(e as Error).message}`);
        failed++;
      }
    }
    return { sent, skipped, failed };
  }
}
