import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config';

/**
 * Fixed-window rate limiter backed by Redis (shared across API instances), with an in-memory
 * fallback when Redis is unavailable (single-instance development only).
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger('RateLimit');
  private redis: Redis | null = null;
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.REDIS_URL && config.NODE_ENV !== 'test') {
      this.redis = new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false });
      this.redis.on('error', (e) => this.logger.warn(`Redis unavailable, using in-memory limiter: ${e.message}`));
    }
  }

  /** Returns true when the request is allowed. */
  async hit(key: string, max: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }> {
    if (this.config.RATE_LIMIT_DISABLED) return { allowed: true, retryAfter: 0 };
    const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    if (this.redis && this.redis.status === 'ready') {
      try {
        const n = await this.redis.incr(bucket);
        if (n === 1) await this.redis.expire(bucket, windowSeconds + 1);
        return { allowed: n <= max, retryAfter: windowSeconds };
      } catch {
        /* fall through to memory */
      }
    }
    const now = Date.now();
    const entry = this.memory.get(bucket);
    if (!entry || entry.resetAt < now) {
      this.memory.set(bucket, { count: 1, resetAt: now + windowSeconds * 1000 });
      if (this.memory.size > 10_000) this.sweep(now);
      return { allowed: true, retryAfter: 0 };
    }
    entry.count++;
    return { allowed: entry.count <= max, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  private sweep(now: number) {
    for (const [k, v] of this.memory) if (v.resetAt < now) this.memory.delete(k);
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }
}
