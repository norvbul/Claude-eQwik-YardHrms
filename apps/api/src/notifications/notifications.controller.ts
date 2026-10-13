import { Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NOTIFICATION_CATEGORIES, notificationPreferencesSchema } from '@yardhrms/types';
import { z } from 'zod';
import { requireTenant, type AuthContext } from '../auth/auth-context';
import { AllowReadOnly, Auth } from '../common/decorators';
import { notFound } from '../common/errors';
import { ZBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Notifications')
@Controller('notifications')
@AllowReadOnly()
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Auth() a: AuthContext, @Query('unread') unread?: string, @Query('page') pageRaw?: string) {
    const auth = requireTenant(a);
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = 20;
    const where = { userId: auth.user.id, OR: [{ tenantId: auth.tenantId }, { tenantId: null }], ...(unread === 'true' ? { readAt: null } : {}) };
    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, category: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true } }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: auth.user.id, OR: [{ tenantId: auth.tenantId }, { tenantId: null }], readAt: null } }),
    ]);
    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), unread: unreadCount };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Auth() a: AuthContext, @Param('id') id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId: a.user.id, readAt: null }, data: { readAt: new Date() } });
    if (!res.count && !(await this.prisma.notification.findFirst({ where: { id, userId: a.user.id } }))) throw notFound('Notification');
    return { read: true };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@Auth() a: AuthContext) {
    const auth = requireTenant(a);
    const res = await this.prisma.notification.updateMany({ where: { userId: auth.user.id, OR: [{ tenantId: auth.tenantId }, { tenantId: null }], readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  @Get('preferences')
  async preferences(@Auth() a: AuthContext) {
    const prefs = await this.prisma.notificationPreference.findMany({ where: { userId: a.user.id } });
    return NOTIFICATION_CATEGORIES.map((c) => ({ ...c, email: c.mandatory ? true : (prefs.find((p) => p.category === c.key)?.email ?? true) }));
  }

  @Put('preferences')
  async savePreferences(@Auth() a: AuthContext, @ZBody(notificationPreferencesSchema) body: z.infer<typeof notificationPreferencesSchema>) {
    for (const c of NOTIFICATION_CATEGORIES) {
      if (c.mandatory || body.email[c.key] === undefined) continue;
      await this.prisma.notificationPreference.upsert({
        where: { userId_category: { userId: a.user.id, category: c.key } },
        create: { userId: a.user.id, category: c.key, email: body.email[c.key] },
        update: { email: body.email[c.key] },
      });
    }
    return this.preferences(a);
  }
}
