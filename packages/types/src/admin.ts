import { z } from 'zod';
import { emailSchema } from './auth';

export const inviteUserSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2).max(120),
  roleCodes: z.array(z.string()).min(1, 'Choose at least one role'),
  employeeId: z.string().optional().nullable(),
});

export const updateMembershipSchema = z.object({
  roleIds: z.array(z.string()).min(1).optional(),
  employeeId: z.string().nullable().optional(),
});

export const roleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(255).optional().nullable(),
  permissions: z.array(z.string()).min(1),
});

export const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().max(80).optional(),
  entityType: z.string().max(80).optional(),
  actorUserId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const importMappingSchema = z.object({
  mapping: z.record(z.string(), z.string()),
});

export const IMPORT_TEMPLATE_VERSION = '1.0';

export const EMPLOYEE_IMPORT_COLUMNS = [
  { key: 'employeeNumber', label: 'Employee Number', required: false, help: 'Blank = create (auto-numbered); existing number = update' },
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'middleName', label: 'Middle Name', required: false },
  { key: 'lastName', label: 'Last Name', required: true },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'dateOfBirth', label: 'Date of Birth (YYYY-MM-DD)', required: false },
  { key: 'gender', label: 'Gender (FEMALE/MALE/OTHER/UNDISCLOSED)', required: false },
  { key: 'addressLine1', label: 'Address', required: false },
  { key: 'city', label: 'City/Town', required: false },
  { key: 'parish', label: 'Parish', required: false },
  { key: 'trn', label: 'TRN', required: false },
  { key: 'nisNumber', label: 'NIS Number', required: false },
  { key: 'nhtNumber', label: 'NHT Number', required: false },
  { key: 'department', label: 'Department Code', required: false },
  { key: 'branch', label: 'Branch Code', required: false },
  { key: 'position', label: 'Position Code', required: false },
  { key: 'employmentType', label: 'Employment Type Code', required: false },
  { key: 'hireDate', label: 'Hire Date (YYYY-MM-DD)', required: true },
  { key: 'payFrequency', label: 'Pay Frequency (WEEKLY/FORTNIGHTLY/MONTHLY)', required: true },
  { key: 'payType', label: 'Pay Type (SALARY/HOURLY)', required: true },
  { key: 'salaryPerPeriod', label: 'Salary per Period', required: false },
  { key: 'hourlyRate', label: 'Hourly Rate', required: false },
  { key: 'overtimeEligible', label: 'Overtime Eligible (Y/N)', required: false },
] as const;

export const TIMESHEET_IMPORT_COLUMNS = [
  { key: 'employeeNumber', label: 'Employee Number', required: true },
  { key: 'workDate', label: 'Work Date (YYYY-MM-DD)', required: true },
  { key: 'shift', label: 'Shift Code', required: false },
  { key: 'startTime', label: 'Start Time (HH:mm)', required: true },
  { key: 'endTime', label: 'End Time (HH:mm)', required: true },
  { key: 'breakHours', label: 'Break Hours', required: false },
  { key: 'comments', label: 'Comments', required: false },
] as const;

/** MFA reset after out-of-band identity verification (lost authenticator). */
export const mfaResetSchema = z.object({ reason: z.string().trim().min(10, 'Describe how the person’s identity was verified (min 10 characters)').max(500) });
export const platformMfaResetSchema = mfaResetSchema.extend({ email: z.string().trim().toLowerCase().email() });

/** Notification categories; each can be switched off for email (in-app notifications always appear). */
export const NOTIFICATION_CATEGORIES = [
  { key: 'approvals', label: 'Items waiting for my approval', mandatory: false },
  { key: 'decisions', label: 'Decisions on requests I submitted or that concern me', mandatory: false },
  { key: 'payroll', label: 'Payroll runs needing review or approval', mandatory: false },
  { key: 'payslips', label: 'New payslips', mandatory: false },
  { key: 'subscription', label: 'Subscription expiry and renewal reminders (administrators)', mandatory: true },
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]['key'];
export const notificationPreferencesSchema = z.object({
  email: z.record(z.string(), z.boolean()),
});

/**
 * Retention periods (NFR-011). Defaults follow Jamaican requirements as researched on 2026-10-13 and must be
 * confirmed by the owner's legal adviser: the Income Tax (Employments) Regulations require employers to keep
 * records of emoluments and deductions for not less than seven years; the Data Protection Act, 2020 requires
 * personal data not be kept longer than necessary (subject to periods prescribed by law).
 */
export const RETENTION_RULES = [
  {
    key: 'payrollRecords',
    label: 'Payroll runs, payslips and statutory deduction records',
    unit: 'years',
    defaultValue: 7,
    min: 7,
    max: 20,
    from: 'end of the tax year in which the pay date falls',
    basis: 'Income Tax (Employments) Regulations (Income Tax Act, Second Schedule): records of emoluments and deductions kept for not less than seven years.',
  },
  {
    key: 'employeeRecords',
    label: 'Former employees’ personal details (anonymised afterwards; payroll history kept)',
    unit: 'years',
    defaultValue: 7,
    min: 7,
    max: 20,
    from: 'termination date',
    basis: 'Supports the payroll records above and the six-year limitation period for contract claims; Data Protection Act storage limitation thereafter.',
  },
  {
    key: 'employeeDocuments',
    label: 'Former employees’ uploaded documents (IDs, certificates, letters)',
    unit: 'years',
    defaultValue: 2,
    min: 0,
    max: 20,
    from: 'termination date',
    basis: 'Data Protection Act, 2020 storage limitation — kept only while needed for references or disputes.',
  },
  {
    key: 'auditLog',
    label: 'Audit log',
    unit: 'years',
    defaultValue: 7,
    min: 7,
    max: 20,
    from: 'date of the event',
    basis: 'Evidence for the payroll and personnel records it relates to.',
  },
  {
    key: 'bankFiles',
    label: 'Generated bank upload files (contain account numbers)',
    unit: 'days',
    defaultValue: 90,
    min: 30,
    max: 3650,
    from: 'generation',
    basis: 'Data minimisation; the payroll register remains the record of payment.',
  },
  {
    key: 'importFiles',
    label: 'Uploaded import spreadsheets and their row data',
    unit: 'days',
    defaultValue: 90,
    min: 7,
    max: 3650,
    from: 'upload',
    basis: 'Data minimisation; imported records themselves are kept under their own rules.',
  },
  {
    key: 'notifications',
    label: 'In-app notifications',
    unit: 'days',
    defaultValue: 365,
    min: 30,
    max: 3650,
    from: 'creation',
    basis: 'Operational convenience only.',
  },
] as const;
export type RetentionKey = (typeof RETENTION_RULES)[number]['key'];
export type RetentionPolicy = Record<RetentionKey, number>;
export const defaultRetentionPolicy = (): RetentionPolicy => Object.fromEntries(RETENTION_RULES.map((r) => [r.key, r.defaultValue])) as RetentionPolicy;

export const retentionPolicySchema = z
  .object(Object.fromEntries(RETENTION_RULES.map((r) => [r.key, z.coerce.number().int().min(r.min, `${r.label}: at least ${r.min} ${r.unit}`).max(r.max)])) as unknown as Record<RetentionKey, z.ZodType<number>>)
  .partial();
export const legalHoldSchema = z.object({ enabled: z.boolean(), reason: z.string().trim().min(5).max(500).optional().nullable() }).refine((v) => !v.enabled || !!v.reason, { path: ['reason'], message: 'A reason is required to place a legal hold' });
export const deletionRequestSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
  confirmName: z.string().trim().min(1).max(190),
});
export const deletionDecisionSchema = z.object({ note: z.string().trim().min(5).max(1000) });
