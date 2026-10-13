import { z } from 'zod';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use HH:mm (24-hour)');
/** Money is transported as a decimal string to avoid floating-point loss. */
export const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d{1,15}(\.\d{1,2})?$/.test(v), 'Enter a valid amount with up to 2 decimal places');
export const positiveMoney = moneyString.refine((v) => !v.startsWith('-'), 'Amount cannot be negative');
export const decimalString = (dp = 4) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => new RegExp(`^\\d{1,12}(\\.\\d{1,${dp}})?$`).test(v), `Enter a non-negative number with up to ${dp} decimals`);
export const rateFraction = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^(0(\.\d{1,6})?|1(\.0{1,6})?)$/.test(v), 'Rate must be a fraction between 0 and 1 (e.g. 0.025)');

export const uuid = z.string().min(1).max(64);
export const optionalText = (max = 255) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim()));

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().max(100).optional(),
  sort: z.string().max(50).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/** Machine-readable error codes returned by the API. */
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  CSRF_INVALID: 'CSRF_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_SETUP_REQUIRED: 'MFA_SETUP_REQUIRED',
  TENANT_REQUIRED: 'TENANT_REQUIRED',
  FEATURE_NOT_ENTITLED: 'FEATURE_NOT_ENTITLED',
  CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
  SUBSCRIPTION_READ_ONLY: 'SUBSCRIPTION_READ_ONLY',
  SUBSCRIPTION_LOCKED: 'SUBSCRIPTION_LOCKED',
  PAYROLL_LOCKED: 'PAYROLL_LOCKED',
  INVALID_STATE: 'INVALID_STATE',
  BUSINESS_RULE: 'BUSINESS_RULE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const JAMAICAN_PARISHES = [
  'Kingston',
  'St. Andrew',
  'St. Thomas',
  'Portland',
  'St. Mary',
  'St. Ann',
  'Trelawny',
  'St. James',
  'Hanover',
  'Westmoreland',
  'St. Elizabeth',
  'Manchester',
  'Clarendon',
  'St. Catherine',
] as const;

/** Optional field that treats a blank form input ('') as null before validation. */
export const blankable = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());
