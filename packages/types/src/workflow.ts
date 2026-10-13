import { z } from 'zod';
import { decimalString, hhmmField, isoDateField, optionalText } from './shared-fields';

export const ApprovalStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
export const LeaveCategoryEnum = z.enum(['ANNUAL', 'SICK', 'MATERNITY', 'COMPASSIONATE', 'UNPAID', 'STUDY', 'SPECIAL', 'OTHER']);

export const leaveTypeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(80),
  category: LeaveCategoryEnum,
  payPercent: z.coerce.number().min(0).max(100),
  requiresDocument: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const leavePolicySchema = z.object({
  leaveTypeId: z.string().min(1),
  employmentTypeId: optionalText(64),
  annualEntitlementDays: decimalString(2),
  accrualMethod: z.enum(['ANNUAL_GRANT', 'MONTHLY_ACCRUAL', 'NONE']),
  carryForwardMaxDays: decimalString(2),
  carryForwardExpiryMonths: z.coerce.number().int().min(0).max(60).default(0),
  minServiceMonths: z.coerce.number().int().min(0).max(600).default(0),
  effectiveFrom: isoDateField,
  notes: optionalText(255),
});

export const leaveRequestSchema = z
  .object({
    employeeId: z.string().min(1).optional(),
    leaveTypeId: z.string().min(1),
    startDate: isoDateField,
    endDate: isoDateField,
    halfDayStart: z.boolean().default(false),
    halfDayEnd: z.boolean().default(false),
    reason: optionalText(500),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'End date must be on or after the start date' });
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;

export const decisionSchema = z.object({
  comment: optionalText(500),
});
export const rejectSchema = z.object({ comment: z.string().trim().min(3, 'Give a reason for rejection').max(500) });

export const leaveAdjustmentSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  entryType: z.enum(['OPENING', 'ADJUSTMENT', 'ACCRUAL', 'CARRY_FORWARD', 'EXPIRY']),
  days: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => /^-?\d{1,4}(\.\d{1,2})?$/.test(v) && Number(v) !== 0, 'Enter a non-zero number of days'),
  effectiveDate: isoDateField,
  reason: z.string().trim().min(3).max(255),
});

export const timesheetSchema = z.object({
  employeeId: z.string().min(1).optional(),
  workDate: isoDateField,
  shiftTypeId: optionalText(64),
  startTime: hhmmField,
  endTime: hhmmField,
  breakHours: decimalString(2).default('0'),
  comments: optionalText(500),
});
export type TimesheetInput = z.infer<typeof timesheetSchema>;

export const overtimeSchema = z.object({
  employeeId: z.string().min(1).optional(),
  workDate: isoDateField,
  hours: decimalString(2).refine((v) => Number(v) > 0 && Number(v) <= 24, 'Overtime hours must be between 0 and 24'),
  overtimeRuleId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});
export type OvertimeInput = z.infer<typeof overtimeSchema>;

export const overtimeRuleSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(80),
  multiplier: decimalString(3).refine((v) => Number(v) >= 1 && Number(v) <= 5, 'Multiplier should be between 1 and 5'),
  description: optionalText(255),
  active: z.boolean().default(true),
});

export const workflowListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  status: ApprovalStatusEnum.optional(),
  employeeId: z.string().optional(),
  from: isoDateField.optional(),
  to: isoDateField.optional(),
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const bulkDecisionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  comment: optionalText(500),
});
