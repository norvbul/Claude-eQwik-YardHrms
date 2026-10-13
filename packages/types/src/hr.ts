import { z } from 'zod';
import { decimalString, emailSchemaLoose, hhmmField, isoDateField, optionalText, positiveMoney } from './shared-fields';

export const PayFrequencyEnum = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY']);
export const PayTypeEnum = z.enum(['SALARY', 'HOURLY']);
export const GenderEnum = z.enum(['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED']);
export const EmployeeStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']);

export const companyProfileSchema = z.object({
  legalName: z.string().trim().min(2).max(190),
  displayName: z.string().trim().min(2).max(120),
  tradingName: optionalText(190),
  trn: optionalText(20),
  nisEmployerNumber: optionalText(30),
  nhtEmployerNumber: optionalText(30),
  addressLine1: optionalText(190),
  addressLine2: optionalText(190),
  city: optionalText(100),
  parish: optionalText(60),
  phone: optionalText(40),
  email: optionalText(190),
  website: optionalText(190),
  timezone: z.string().max(60).default('America/Jamaica'),
  locale: z.string().max(20).default('en-JM'),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
});
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;

export const payFrequencyConfigSchema = z.object({
  frequency: PayFrequencyEnum,
  standardHours: decimalString(2),
  workingDays: decimalString(2),
  periodsPerYear: z.coerce.number().int().min(1).max(366),
  active: z.boolean().default(true),
});

export const masterDataSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  description: optionalText(255),
  active: z.boolean().default(true),
});
export const departmentSchema = masterDataSchema.extend({ costCenter: optionalText(40) });
export const branchSchema = masterDataSchema.extend({ parish: optionalText(60), address: optionalText(255) });
export const positionSchema = masterDataSchema.extend({ departmentId: optionalText(64) });
export const employmentTypeSchema = masterDataSchema;
export const shiftTypeSchema = masterDataSchema.extend({ defaultStart: hhmmField.optional().nullable(), defaultEnd: hhmmField.optional().nullable() });
export const publicHolidaySchema = z.object({ date: isoDateField, name: z.string().trim().min(2).max(120) });

const employeeBase = z.object({
  employeeNumber: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, dash or underscore only'),
  firstName: z.string().trim().min(1).max(80),
  middleName: optionalText(80),
  lastName: z.string().trim().min(1).max(80),
  preferredName: optionalText(80),
  email: emailSchemaLoose.optional().nullable(),
  phone: optionalText(40),
  mobile: optionalText(40),
  dateOfBirth: isoDateField.optional().nullable(),
  gender: GenderEnum.optional().nullable(),
  addressLine1: optionalText(190),
  addressLine2: optionalText(190),
  city: optionalText(100),
  parish: optionalText(60),
  trn: z
    .string()
    .trim()
    .regex(/^\d{9}$/, 'TRN must be 9 digits')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  nisNumber: optionalText(20),
  nhtNumber: optionalText(20),
  departmentId: optionalText(64),
  branchId: optionalText(64),
  positionId: optionalText(64),
  employmentTypeId: optionalText(64),
  supervisorId: optionalText(64),
  hireDate: isoDateField,
  probationEndDate: isoDateField.optional().nullable(),
  confirmationDate: isoDateField.optional().nullable(),
  payFrequency: PayFrequencyEnum,
  payType: PayTypeEnum,
  salaryPerPeriod: positiveMoney.optional().nullable(),
  hourlyRate: positiveMoney.optional().nullable(),
  standardHoursOverride: decimalString(2).optional().nullable(),
  overtimeEligible: z.boolean().default(false),
  statutoryExemptions: z.array(z.string().max(20)).max(20).default([]),
});

export const employeeCreateSchema = employeeBase.superRefine((v, ctx) => {
  if (v.payType === 'SALARY' && !v.salaryPerPeriod) ctx.addIssue({ code: 'custom', path: ['salaryPerPeriod'], message: 'Salary per pay period is required for salaried employees' });
  if (v.payType === 'HOURLY' && !v.hourlyRate) ctx.addIssue({ code: 'custom', path: ['hourlyRate'], message: 'Hourly rate is required for hourly employees' });
  if (v.payType === 'HOURLY' && v.payFrequency === 'MONTHLY')
    ctx.addIssue({ code: 'custom', path: ['payType'], message: 'Monthly employees are salaried and do not submit regular timesheets' });
});
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;

/** Personal/job data update — compensation is changed through the compensation endpoint (EMP-006). */
export const employeeUpdateSchema = employeeBase
  .omit({ payType: true, salaryPerPeriod: true, hourlyRate: true, payFrequency: true, standardHoursOverride: true, overtimeEligible: true, statutoryExemptions: true })
  .partial()
  .extend({
    statutoryExemptions: z.array(z.string().max(20)).max(20).optional(),
    version: z.number().int().min(0),
    changeReason: optionalText(255),
  });
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;

export const compensationChangeSchema = z
  .object({
    effectiveDate: isoDateField,
    payFrequency: PayFrequencyEnum,
    payType: PayTypeEnum,
    salaryPerPeriod: positiveMoney.optional().nullable(),
    hourlyRate: positiveMoney.optional().nullable(),
    standardHoursOverride: decimalString(2).optional().nullable(),
    overtimeEligible: z.boolean(),
    reason: z.string().trim().min(3).max(255),
  })
  .superRefine((v, ctx) => {
    if (v.payType === 'SALARY' && !v.salaryPerPeriod) ctx.addIssue({ code: 'custom', path: ['salaryPerPeriod'], message: 'Required for salaried employees' });
    if (v.payType === 'HOURLY' && !v.hourlyRate) ctx.addIssue({ code: 'custom', path: ['hourlyRate'], message: 'Required for hourly employees' });
    if (v.payType === 'HOURLY' && v.payFrequency === 'MONTHLY') ctx.addIssue({ code: 'custom', path: ['payType'], message: 'Monthly employees must be salaried' });
  });

export const statusChangeSchema = z.object({
  reason: z.string().trim().min(3).max(255),
  effectiveDate: isoDateField.optional(),
  terminate: z.boolean().default(false),
});

export const bankAccountSchema = z.object({
  bankName: z.string().trim().min(2).max(120),
  branchName: optionalText(120),
  branchCode: optionalText(20),
  accountType: z.enum(['SAVINGS', 'CHEQUING', 'OTHER']).default('SAVINGS'),
  accountNumber: z.string().trim().regex(/^[0-9A-Za-z-]{4,34}$/, 'Enter a valid account number'),
  accountHolder: z.string().trim().min(2).max(120),
  isPrimary: z.boolean().default(true),
});

export const emergencyContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  relationship: z.string().trim().min(2).max(60),
  phone: z.string().trim().min(5).max(40),
  email: emailSchemaLoose.optional().nullable(),
  address: optionalText(255),
});

export const employeeAllowanceSchema = z.object({
  allowanceTypeId: z.string().min(1),
  amount: positiveMoney,
  startDate: isoDateField,
  endDate: isoDateField.optional().nullable(),
});
export const employeeDeductionSchema = z.object({
  deductionTypeId: z.string().min(1),
  amount: positiveMoney,
  startDate: isoDateField,
  endDate: isoDateField.optional().nullable(),
  reference: optionalText(80),
  balance: positiveMoney.optional().nullable(),
});

export const employeeListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().max(100).optional(),
  status: EmployeeStatusEnum.optional(),
  departmentId: z.string().optional(),
  payFrequency: PayFrequencyEnum.optional(),
  sort: z.enum(['employeeNumber', 'lastName', 'hireDate', 'createdAt']).default('lastName'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
