import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3000),
  API_PUBLIC_URL: z.string().default('http://localhost:3000'),
  HRMS_WEB_URL: z.string().default('http://localhost:5173'),
  ADMIN_WEB_URL: z.string().default('http://localhost:5174'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  TRUST_PROXY: bool,
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(30),
  COOKIE_SECURE: bool,
  FIELD_ENCRYPTION_KEY: z.string().min(1, 'FIELD_ENCRYPTION_KEY is required (32 bytes base64)'),
  TOKEN_HMAC_KEY: z.string().min(1, 'TOKEN_HMAC_KEY is required (32 bytes base64)'),
  MFA_ENFORCEMENT: z.enum(['required', 'optional']).default('required'),
  MFA_ISSUER: z.string().default('eQwik YardHRMS'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('yardhrms-private'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional().transform((v) => v !== 'false'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('eQwik YardHRMS <no-reply@example.com>'),
  PAYROLL_COMPLIANCE_CERTIFIED: bool,
  RUN_WORKER_IN_API: bool,
  WORKER_POLL_MS: z.coerce.number().default(2000),
  WORKER_ID: z.string().default('worker-1'),
  RATE_LIMIT_DISABLED: bool,
  /** Open decision (PRD §17): require a different Qwik officer to verify a payment than the one who recorded it. */
  PAYMENT_REQUIRE_SEPARATE_VERIFIER: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

export type AppConfig = z.infer<typeof envSchema> & { corsOrigins: string[]; isProduction: boolean };

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const c = parsed.data;
  for (const [name, key] of [
    ['FIELD_ENCRYPTION_KEY', c.FIELD_ENCRYPTION_KEY],
    ['TOKEN_HMAC_KEY', c.TOKEN_HMAC_KEY],
  ] as const) {
    if (Buffer.from(key, 'base64').length < 32) throw new Error(`${name} must decode to at least 32 bytes`);
  }
  if (c.NODE_ENV === 'production') {
    if (c.MFA_ENFORCEMENT !== 'required') throw new Error('MFA_ENFORCEMENT must be "required" in production');
    if (!c.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (c.RATE_LIMIT_DISABLED) throw new Error('RATE_LIMIT_DISABLED is not permitted in production');
  }
  cached = {
    ...c,
    corsOrigins: c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProduction: c.NODE_ENV === 'production',
  };
  return cached;
}

/** Test helper: clears the memoized configuration. */
export function resetConfigCache() {
  cached = null;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
