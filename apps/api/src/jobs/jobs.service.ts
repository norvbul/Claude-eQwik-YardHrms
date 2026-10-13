import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma, type BackgroundJob } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';

export type JobHandler = (payload: any, job: BackgroundJob) => Promise<unknown>;

/**
 * Durable MySQL-backed job queue (PRD §9.2 `background_jobs`). Jobs are claimed with
 * `SELECT … FOR UPDATE SKIP LOCKED`, so multiple workers can run safely. Failed jobs retry with
 * exponential backoff up to `maxAttempts`. Handlers must be idempotent (import rows track outcomes).
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  async enqueue(type: string, payload: Record<string, unknown>, opts: { tenantId?: string | null; dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {}) {
    try {
      return await this.prisma.backgroundJob.create({
        data: {
          type,
          payload: payload as Prisma.InputJsonValue,
          tenantId: opts.tenantId ?? null,
          dedupeKey: opts.dedupeKey ?? null,
          runAt: opts.runAt ?? new Date(),
          maxAttempts: opts.maxAttempts ?? 3,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && opts.dedupeKey) {
        return this.prisma.backgroundJob.findUnique({ where: { dedupeKey: opts.dedupeKey } });
      }
      throw e;
    }
  }

  private async claim(): Promise<BackgroundJob | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM background_jobs
        WHERE status = 'QUEUED' AND run_at <= NOW(3)
        ORDER BY run_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return null;
      return tx.backgroundJob.update({
        where: { id: rows[0].id },
        data: { status: 'RUNNING', lockedAt: new Date(), lockedBy: this.config.WORKER_ID, attempts: { increment: 1 } },
      });
    });
  }

  /** Processes queued jobs until none are due. Returns the number processed. */
  async runPending(limit = 100): Promise<number> {
    let n = 0;
    while (n < limit) {
      const job = await this.claim();
      if (!job) break;
      n++;
      await this.execute(job);
    }
    return n;
  }

  private async execute(job: BackgroundJob) {
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler registered for job type ${job.type}`);
      const result = await handler(job.payload, job);
      await this.prisma.backgroundJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', result: (result ?? null) as Prisma.InputJsonValue, lockedAt: null } });
    } catch (e) {
      const err = e as Error;
      const retry = job.attempts < job.maxAttempts;
      this.logger.error(`Job ${job.type} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}): ${err.message}`);
      await this.prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: retry ? 'QUEUED' : 'FAILED',
          lastError: `${err.message}\n${err.stack ?? ''}`.slice(0, 5000),
          runAt: new Date(Date.now() + Math.min(300_000, 2 ** job.attempts * 5_000)),
          lockedAt: null,
        },
      });
    }
  }

  /** Recovers jobs stuck RUNNING (e.g. worker crash) after a timeout. */
  async recoverStale(timeoutMs = 10 * 60_000) {
    await this.prisma.backgroundJob.updateMany({
      where: { status: 'RUNNING', lockedAt: { lt: new Date(Date.now() - timeoutMs) } },
      data: { status: 'QUEUED', lockedAt: null },
    });
  }

  startPolling(intervalMs = this.config.WORKER_POLL_MS) {
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      if (!this.running) {
        this.running = true;
        try {
          await this.recoverStale();
          await this.runPending();
        } catch (e) {
          this.logger.error(`Polling error: ${(e as Error).message}`);
        } finally {
          this.running = false;
        }
      }
      if (!this.stopped) this.timer = setTimeout(tick, intervalMs);
    };
    this.timer = setTimeout(tick, 100);
    this.logger.log(`Job polling started (${intervalMs} ms) as ${this.config.WORKER_ID}`);
  }

  stopPolling() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  onModuleDestroy() {
    this.stopPolling();
  }
}
