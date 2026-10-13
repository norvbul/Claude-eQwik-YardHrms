/**
 * eQwik YardHRMS background worker.
 * Runs the durable MySQL job queue (imports, payslip PDFs) and scheduled maintenance:
 *  - subscription expiry sweep (ACTIVE → GRACE → EXPIRED), hourly
 *  - leave accrual posting (idempotent posting keys), daily
 *  - recovery of jobs left RUNNING by a crashed worker
 */
import 'reflect-metadata';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: process.env.DOTENV_PATH ?? path.resolve(__dirname, '../../../.env'), quiet: true });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@yardhrms/api/dist/app.module';
import { JobsService } from '@yardhrms/api/dist/jobs/jobs.service';
import { LicensingCore } from '@yardhrms/api/dist/licensing/licensing-core.service';
import { LeaveService } from '@yardhrms/api/dist/leave/leave.service';
import { PrismaService } from '@yardhrms/api/dist/prisma/prisma.service';

const HOUR = 3_600_000;

async function main() {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  const jobs = app.get(JobsService);
  const licensing = app.get(LicensingCore);
  const leave = app.get(LeaveService);
  const prisma = app.get(PrismaService);

  jobs.register('subscriptions.sweep', () => licensing.sweepExpirations());
  jobs.register('leave.accruals', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const tenants = await prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    let posted = 0;
    for (const t of tenants) posted += (await leave.runAccruals(t.id, today, null)).posted;
    return { tenants: tenants.length, posted };
  });

  const schedule = async () => {
    const hourKey = new Date().toISOString().slice(0, 13);
    const dayKey = new Date().toISOString().slice(0, 10);
    await jobs.enqueue('subscriptions.sweep', {}, { dedupeKey: `sweep:${hourKey}` });
    await jobs.enqueue('leave.accruals', {}, { dedupeKey: `accruals:${dayKey}` });
    await jobs.enqueue('retention.daily', {}, { dedupeKey: `retention:${dayKey}` });
    // Safety net for notification emails (each notify() also enqueues an immediate delivery job).
    await jobs.enqueue('notifications.deliver', {}, { dedupeKey: `notify:${new Date().toISOString().slice(0, 15)}` });
  };
  await schedule();
  const timer = setInterval(() => schedule().catch((e) => logger.error(e.message)), HOUR / 4);

  jobs.startPolling();
  logger.log('Worker started');
  const stop = async () => {
    clearInterval(timer);
    jobs.stopPolling();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
