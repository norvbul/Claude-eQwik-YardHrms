import { z } from 'zod';
import { emailSchemaLoose, isoDateField, optionalText, positiveMoney } from './shared-fields';

export const redeemCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{16,64}$/, 'Enter the activation code exactly as issued'),
});

export const PaymentMethodEnum = z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']);
export const PaymentStatusEnum = z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'REVERSED']);

export const customerSchema = z.object({
  name: z.string().trim().min(2).max(190),
  contactName: optionalText(120),
  email: emailSchemaLoose.optional().nullable(),
  phone: optionalText(40),
  address: optionalText(255),
  trn: optionalText(20),
  notes: optionalText(1000),
  tenantId: optionalText(64),
});

export const productSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(2).max(120),
  description: optionalText(500),
  active: z.boolean().default(true),
});

export const planSchema = z.object({
  productId: z.string().min(1),
  code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(2).max(120),
  isFree: z.boolean().default(false),
  price: positiveMoney.nullable().optional(),
  currency: z.string().trim().length(3).toUpperCase().default('JMD'),
  durationMonths: z.coerce.number().int().min(1).max(120).nullable().optional(),
  employeeLimit: z.coerce.number().int().min(1).max(100000),
  userLimit: z.coerce.number().int().min(1).max(100000),
  gracePeriodDays: z.coerce.number().int().min(0).max(365),
  status: z.enum(['ACTIVE', 'RETIRED']).default('ACTIVE'),
  features: z.array(z.string()).default([]),
});

export const paymentSchema = z
  .object({
    customerId: z.string().min(1),
    planId: optionalText(64),
    invoiceNumber: optionalText(60),
    reference: z.string().trim().min(2).max(120),
    paymentDate: isoDateField,
    amount: positiveMoney.refine((v) => Number(v) > 0, 'Amount must be greater than zero'),
    currency: z.string().trim().length(3).toUpperCase(),
    method: PaymentMethodEnum,
    periodStart: isoDateField.optional().nullable(),
    periodEnd: isoDateField.optional().nullable(),
    notes: optionalText(1000),
  })
  .refine((v) => !v.periodStart || !v.periodEnd || v.periodEnd >= v.periodStart, { path: ['periodEnd'], message: 'Period end must follow start' });

export const paymentDecisionSchema = z.object({ reason: optionalText(500) });
export const paymentRejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const subscriptionCreateSchema = z
  .object({
    customerId: z.string().min(1),
    planId: z.string().min(1),
    paymentId: optionalText(64),
    override: z.boolean().default(false),
    overrideReason: optionalText(500),
    employeeLimitOverride: z.coerce.number().int().min(1).max(100000).nullable().optional(),
    userLimitOverride: z.coerce.number().int().min(1).max(100000).nullable().optional(),
    /** Directly apply to the customer's linked tenant instead of issuing a code. */
    applyToTenantDirectly: z.boolean().default(false),
  })
  .refine((v) => !!v.paymentId || (v.override && !!v.overrideReason && v.overrideReason.length >= 10), {
    path: ['paymentId'],
    message: 'A verified payment is required unless a reasoned commercial override is given (min 10 characters)',
  });

export const renewSchema = z
  .object({
    paymentId: optionalText(64),
    months: z.coerce.number().int().min(1).max(120).optional(),
    override: z.boolean().default(false),
    overrideReason: optionalText(500),
  })
  .refine((v) => !!v.paymentId || (v.override && !!v.overrideReason && v.overrideReason.length >= 10), {
    path: ['paymentId'],
    message: 'A verified payment is required unless a reasoned commercial override is given',
  });

export const changePlanSchema = z.object({ planId: z.string().min(1), reason: z.string().trim().min(3).max(500) });
export const capacitySchema = z.object({
  employeeLimitOverride: z.coerce.number().int().min(1).max(100000).nullable(),
  userLimitOverride: z.coerce.number().int().min(1).max(100000).nullable(),
  reason: z.string().trim().min(3).max(500),
});
export const subscriptionStateChangeSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const codeIssueSchema = z.object({
  subscriptionId: z.string().min(1),
  expiresInDays: z.coerce.number().int().min(1).max(180).default(30),
});

export const staffSchema = z.object({
  email: emailSchemaLoose.pipe(z.string().min(3)),
  fullName: z.string().trim().min(2).max(120),
  platformRole: z.enum(['PLATFORM_SUPER_ADMIN', 'PLATFORM_LICENSING_OFFICER']),
});
