import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '@yardhrms/api/dist/app.module';
import { PrismaService } from '@yardhrms/api/dist/prisma/prisma.service';

/** Boots the API's dependency graph (no HTTP server) so the migration reuses the real services and rules. */
export async function withApp<T>(fn: (app: INestApplicationContext, prisma: PrismaService) => Promise<T>): Promise<T> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    return await fn(app, app.get(PrismaService));
  } finally {
    await app.close();
  }
}

export interface MigrationActor {
  tenantId: string;
  tenantName: string;
  user: { id: string; email: string; fullName: string };
}

/**
 * The operator acts as a named tenant administrator (the customer's Admin, or a Qwik migration officer
 * invited into the tenant for the engagement) so every record and audit event has an accountable actor.
 */
export async function resolveActor(prisma: PrismaService, tenantRef: string, actorEmail: string): Promise<MigrationActor> {
  const tenant = await prisma.tenant.findFirst({ where: { OR: [{ id: tenantRef }, { slug: tenantRef }] } });
  if (!tenant) throw new Error(`Tenant "${tenantRef}" not found (use its slug or id). Create the company first via sign-up or the Licence Manager.`);
  const user = await prisma.user.findUnique({ where: { email: actorEmail.toLowerCase() } });
  if (!user) throw new Error(`User ${actorEmail} not found`);
  const membership = await prisma.tenantMembership.findFirst({
    where: { tenantId: tenant.id, userId: user.id, status: 'ACTIVE' },
    include: { roles: { include: { role: true } } },
  });
  if (!membership || !membership.roles.some((r) => r.role.code === 'COMPANY_ADMIN')) {
    throw new Error(`${actorEmail} must be an active Company Administrator of ${tenant.displayName} to run a migration`);
  }
  return { tenantId: tenant.id, tenantName: tenant.displayName, user: { id: user.id, email: user.email, fullName: user.fullName } };
}
