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
