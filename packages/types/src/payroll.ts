import { z } from 'zod';
import { blankable } from './common';
import { PayFrequencyEnum } from './hr';
import { decimalString, isoDateField, optionalText, positiveMoney, rateFraction, optionalIsoDate } from './shared-fields';

export const PayrollRunStatusEnum = z.enum(['DRAFT', 'PREPARED', 'REVIEWED', 'APPROVED', 'LOCKED']);

export const allowanceTypeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(80),
  taxable: z.boolean(),
  active: z.boolean().default(true),
});

export const deductionTypeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(80),
  category: z.enum(['PENSION', 'INSURANCE', 'LOAN', 'ADVANCE', 'UNION', 'GARNISHMENT', 'OTHER']),
  preTax: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const taxBracketSchema = z.object({
  upToAnnual: blankable(positiveMoney),
  rate: rateFraction,
});

export const statutoryComponentSchema = z.object({
  code: z.string().trim().min(1).max(20).regex(/^[A-Z0-9_]+$/, 'Upper-case letters, digits and underscore'),
  name: z.string().trim().min(2).max(80),
  sortOrder: z.coerce.number().int().min(0).max(1000),
  base: z.enum(['GROSS', 'TAXABLE_GROSS', 'STATUTORY_INCOME']),
  employeeRate: rateFraction,
  employerRate: rateFraction,
  annualCeiling: blankable(positiveMoney),
  annualThreshold: blankable(positiveMoney),
  reducesStatutoryIncome: z.boolean().default(false),
  minAge: blankable(z.coerce.number().int().min(0).max(120)),
  maxAge: blankable(z.coerce.number().int().min(0).max(120)),
  brackets: z.array(taxBracketSchema).max(10).default([]),
  calculationMethod: z.enum(['PERIOD', 'CUMULATIVE']).default('PERIOD'),
  bracketBasis: z.enum(['AFTER_THRESHOLD', 'BEFORE_THRESHOLD']).default('AFTER_THRESHOLD'),
  notes: optionalText(500),
});

export const importReferencePackSchema = z.object({ key: z.string().trim().min(3).max(40) });

export const statutoryVersionSchema = z.object({
  name: z.string().trim().min(3).max(120),
  effectiveFrom: isoDateField,
  effectiveTo: optionalIsoDate,
  sourceReference: optionalText(500),
  components: z.array(statutoryComponentSchema).min(1).max(20),
});
export type StatutoryVersionInput = z.infer<typeof statutoryVersionSchema>;

export const statutoryApproveSchema = z.object({
  attestation: z
    .string()
    .trim()
    .min(20, 'Describe the authoritative source and reviewer of these rates (min 20 characters)')
    .max(1000),
});

export const payrollRunCreateSchema = z
  .object({
    frequency: PayFrequencyEnum,
    periodStart: isoDateField,
    periodEnd: isoDateField,
    payDate: isoDateField,
    runType: z.enum(['REGULAR', 'SUPPLEMENTAL']).default('REGULAR'),
    departmentId: optionalText(64),
    employeeIds: z.array(z.string()).max(1000).optional(),
    notes: optionalText(500),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ['periodEnd'], message: 'Period end must be after start' });
export type PayrollRunCreateInput = z.infer<typeof payrollRunCreateSchema>;

export const payrollAdjustmentSchema = z.object({
  employeeId: z.string().min(1),
  kind: z.enum(['BONUS', 'COMMISSION', 'RETRO', 'ALLOWANCE', 'OTHER_EARNING', 'DEDUCTION']),
  description: z.string().trim().min(2).max(120),
  amount: positiveMoney,
  taxable: z.boolean().default(true),
  preTax: z.boolean().default(false),
});

export const payrollTransitionSchema = z.object({ comment: optionalText(500) });
export const payrollReverseSchema = z.object({ reason: z.string().trim().min(5).max(500) });

export const payFrequencySettingsSchema = z.object({
  items: z
    .array(
      z.object({
        frequency: PayFrequencyEnum,
        standardHours: decimalString(2),
        workingDays: decimalString(2),
        periodsPerYear: z.coerce.number().int().min(1).max(366),
        active: z.boolean(),
      }),
    )
    .min(1)
    .max(3),
  requireSeparateApprover: z.boolean().default(true),
  taxYearStartMonth: z.coerce.number().int().min(1).max(12).default(1),
});
