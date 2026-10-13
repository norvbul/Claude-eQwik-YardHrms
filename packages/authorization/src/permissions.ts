/**
 * Atomic tenant permissions (PRD §4 "Permission model").
 * Roles map to these permissions; licence entitlements are a separate layer (see features.ts).
 */
export const TenantPermissions = {
  SETTINGS_READ: 'tenant.settings.read',
  SETTINGS_WRITE: 'tenant.settings.write',
  MASTER_DATA_WRITE: 'masterdata.write',
  USERS_READ: 'users.read',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',

  EMPLOYEES_READ: 'employees.read',
  EMPLOYEES_WRITE: 'employees.write',
  EMPLOYEES_SENSITIVE_READ: 'employees.sensitive.read',
  COMPENSATION_READ: 'compensation.read',
  COMPENSATION_WRITE: 'compensation.write',
  DOCUMENTS_MANAGE: 'employees.documents.manage',

  LEAVE_SUBMIT_SELF: 'leave.submit.self',
  LEAVE_SUBMIT_ANY: 'leave.submit.any',
  LEAVE_READ_ANY: 'leave.read.any',
  LEAVE_APPROVE: 'leave.approve',
  LEAVE_ADJUST: 'leave.adjust',
  LEAVE_POLICY_MANAGE: 'leave.policy.manage',

  TIMESHEETS_SUBMIT_SELF: 'timesheets.submit.self',
  TIMESHEETS_SUBMIT_ANY: 'timesheets.submit.any',
  TIMESHEETS_READ_ANY: 'timesheets.read.any',
  TIMESHEETS_APPROVE: 'timesheets.approve',

  OVERTIME_SUBMIT_SELF: 'overtime.submit.self',
  OVERTIME_SUBMIT_ANY: 'overtime.submit.any',
  OVERTIME_READ_ANY: 'overtime.read.any',
  OVERTIME_APPROVE: 'overtime.approve',

  PAYROLL_CONFIG_MANAGE: 'payroll.config.manage',
  STATUTORY_MANAGE: 'statutory.manage',
  STATUTORY_APPROVE: 'statutory.approve',
  PAYROLL_READ: 'payroll.read',
  PAYROLL_PREPARE: 'payroll.prepare',
  PAYROLL_REVIEW: 'payroll.review',
  PAYROLL_APPROVE: 'payroll.approve',
  PAYROLL_LOCK: 'payroll.lock',
  PAYROLL_REVERSE: 'payroll.reverse',
  PAYROLL_EXPORT: 'payroll.export',

  PAYSLIPS_READ_SELF: 'payslips.read.self',
  PAYSLIPS_PRINT_ANY: 'payslips.print.any',

  REPORTS_HR: 'reports.hr',
  REPORTS_PAYROLL: 'reports.payroll',
  REPORTS_EXPORT: 'reports.export',

  IMPORTS_MANAGE: 'imports.manage',

  SUBSCRIPTION_READ: 'subscription.read',
  SUBSCRIPTION_MANAGE: 'subscription.manage',

  AUDIT_READ: 'audit.read',
} as const;

export type TenantPermission = (typeof TenantPermissions)[keyof typeof TenantPermissions];
export const ALL_TENANT_PERMISSIONS: TenantPermission[] = Object.values(TenantPermissions);

/** Qwik platform (Licence Manager) permissions. Never granted to tenant memberships. */
export const PlatformPermissions = {
  DASHBOARD: 'platform.dashboard.read',
  CUSTOMERS_READ: 'platform.customers.read',
  CUSTOMERS_WRITE: 'platform.customers.write',
  CATALOG_MANAGE: 'platform.catalog.manage',
  PAYMENTS_READ: 'platform.payments.read',
  PAYMENTS_RECORD: 'platform.payments.record',
  PAYMENTS_VERIFY: 'platform.payments.verify',
  PAYMENTS_REVERSE: 'platform.payments.reverse',
  SUBSCRIPTIONS_READ: 'platform.subscriptions.read',
  SUBSCRIPTIONS_MANAGE: 'platform.subscriptions.manage',
  SUBSCRIPTIONS_SUSPEND: 'platform.subscriptions.suspend',
  COMMERCIAL_OVERRIDE: 'platform.override',
  CODES_ISSUE: 'platform.codes.issue',
  CODES_REVOKE: 'platform.codes.revoke',
  USAGE_READ: 'platform.usage.read',
  AUDIT_READ: 'platform.audit.read',
  STAFF_MANAGE: 'platform.staff.manage',
  ACCOUNTS_MFA_RESET: 'platform.accounts.mfa_reset',
} as const;

export type PlatformPermission = (typeof PlatformPermissions)[keyof typeof PlatformPermissions];
export const ALL_PLATFORM_PERMISSIONS: PlatformPermission[] = Object.values(PlatformPermissions);

export type AnyPermission = TenantPermission | PlatformPermission;

/** Human readable descriptions used when seeding the permissions table. */
export const PERMISSION_DESCRIPTIONS: Record<TenantPermission, string> = {
  'tenant.settings.read': 'View company settings',
  'tenant.settings.write': 'Change company profile, branding and payroll settings',
  'masterdata.write': 'Maintain branches, departments, positions, employment types, shifts and holidays',
  'users.read': 'View company users',
  'users.manage': 'Invite, activate and deactivate users; assign roles',
  'roles.manage': 'Create roles and change role permissions',
  'employees.read': 'View employee directory and profiles',
  'employees.write': 'Create, edit, deactivate and reactivate employees',
  'employees.sensitive.read': 'View unmasked TRN/NIS/NHT and bank details',
  'compensation.read': 'View salary and compensation history',
  'compensation.write': 'Change compensation, allowances and deductions',
  'employees.documents.manage': 'Upload and remove employee documents',
  'leave.submit.self': 'Submit own leave requests',
  'leave.submit.any': 'Submit leave on behalf of any active employee',
  'leave.read.any': 'View leave for all employees',
  'leave.approve': 'Approve or reject leave requests',
  'leave.adjust': 'Post leave balance adjustments and opening balances',
  'leave.policy.manage': 'Configure leave types and policies',
  'timesheets.submit.self': 'Submit own regular timesheets',
  'timesheets.submit.any': 'Submit timesheets on behalf of any eligible employee',
  'timesheets.read.any': 'View timesheets for all employees',
  'timesheets.approve': 'Approve or reject timesheets',
  'overtime.submit.self': 'Submit own overtime requests',
  'overtime.submit.any': 'Submit overtime on behalf of any eligible employee',
  'overtime.read.any': 'View overtime for all employees',
  'overtime.approve': 'Approve or reject overtime',
  'payroll.config.manage': 'Configure pay frequencies, allowance/deduction types and overtime rules',
  'statutory.manage': 'Draft statutory rule versions',
  'statutory.approve': 'Approve statutory rule versions for payroll use',
  'payroll.read': 'View payroll runs and registers',
  'payroll.prepare': 'Create, calculate and prepare payroll runs',
  'payroll.review': 'Mark prepared payroll as reviewed',
  'payroll.approve': 'Approve payroll runs',
  'payroll.lock': 'Lock approved payroll runs',
  'payroll.reverse': 'Create reversal / correction runs',
  'payroll.export': 'Generate bank files and statutory payroll exports',
  'payslips.read.self': 'View own payslips',
  'payslips.print.any': 'View and print approved payslips for any employee',
  'reports.hr': 'Run HR reports',
  'reports.payroll': 'Run payroll reports',
  'reports.export': 'Export reports to CSV/XLSX/PDF',
  'imports.manage': 'Run bulk employee and timesheet imports',
  'subscription.read': 'View subscription, plan and usage',
  'subscription.manage': 'Redeem activation codes',
  'audit.read': 'View the company audit log',
};

export const PLATFORM_PERMISSION_DESCRIPTIONS: Record<PlatformPermission, string> = {
  'platform.dashboard.read': 'View licence manager dashboard',
  'platform.customers.read': 'View customers and tenants',
  'platform.customers.write': 'Create and edit customers',
  'platform.catalog.manage': 'Manage products, plans and features',
  'platform.payments.read': 'View manual payments',
  'platform.payments.record': 'Record manual payments and evidence',
  'platform.payments.verify': 'Verify or reject manual payments',
  'platform.payments.reverse': 'Reverse verified payments',
  'platform.subscriptions.read': 'View subscriptions and licences',
  'platform.subscriptions.manage': 'Create, renew and change subscriptions',
  'platform.subscriptions.suspend': 'Suspend, revoke and reinstate subscriptions',
  'platform.override': 'Issue subscriptions under an audited commercial override',
  'platform.codes.issue': 'Generate activation codes',
  'platform.codes.revoke': 'Revoke activation codes',
  'platform.usage.read': 'Monitor tenant capacity usage',
  'platform.audit.read': 'View the platform audit log',
  'platform.staff.manage': 'Manage Qwik staff accounts',
  'platform.accounts.mfa_reset': "Reset a user's MFA after verifying their identity",
};
