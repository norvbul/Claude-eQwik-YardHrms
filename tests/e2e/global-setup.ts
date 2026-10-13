import { createRequire } from 'node:module';
import path from 'node:path';
import { config } from 'dotenv';

/**
 * Local/CI convenience: the journeys register companies and sign in repeatedly, which the API
 * deliberately rate-limits per IP. Clear the limiter buckets in the (non-production) Redis first so
 * repeated runs are deterministic. Never point E2E at a production Redis.
 */
export default async function globalSetup() {
  const root = path.resolve(__dirname, '../..');
  config({ path: path.join(root, '.env'), quiet: true });
  const url = process.env.REDIS_URL;
  if (!url || process.env.NODE_ENV === 'production') return;
  const Redis = createRequire(path.join(root, 'apps/api/package.json'))('ioredis');
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } catch {
    // Redis unavailable: the API is using its in-memory limiter; restart the API to reset it.
  } finally {
    redis.disconnect();
  }
}
