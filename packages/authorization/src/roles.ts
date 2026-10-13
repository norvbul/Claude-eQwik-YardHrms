import {
  ALL_PLATFORM_PERMISSIONS,
  ALL_TENANT_PERMISSIONS,
  PlatformPermission,
  PlatformPermissions as PP,
  TenantPermission,
  TenantPermissions as P,
} from './permissions';

export const TenantRoleCodes = {
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  HR_OFFICER: 'HR_OFFICER',
  PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  FINANCE_APPROVER: 'FINANCE_APPROVER',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE',
} as const;
export type TenantRoleCode = (typeof TenantRoleCodes)[keyof typeof TenantRoleCodes];

export const PlatformRoleCodes = {
  SUPER_ADMIN: 'PLATFORM_SUPER_ADMIN',
  LICENSING_OFFICER: 'PLATFORM_LICENSING_OFFICER',
} as const;
export type PlatformRoleCode = (typeof PlatformRoleCodes)[keyof typeof PlatformRoleCodes];

const SELF_SERVICE: TenantPermission[] = [
  P.LEAVE_SUBMIT_SELF,
  P.TIMESHEETS_SUBMIT_SELF,
  P.OVERTIME_SUBMIT_SELF,
  P.PAYSLIPS_READ_SELF,
];

export interface RoleTemplate {
  code: TenantRoleCode;
  name: string;
  description: string;
  permissions: TenantPermission[];
  /** PRD SEC-006: MFA required for tenant Admin / Payroll / Finance roles at launch. */
  privileged: boolean;
}

/**
 * Seeded tenant role templates. Each tenant receives its own editable copy at registration.
 * Delegation rule (PRD §4): Admin, Payroll Officer and Manager may submit for any active employee and
 * print approved payslips for any employee. Submission rights never imply approval rights.
 */
export const TENANT_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    code: 'COMPANY_ADMIN',
    name: 'Company Administrator',
    description: 'Full control of company settings, people, payroll configuration and access.',
    permissions: [...ALL_TENANT_PERMISSIONS],
    privileged: true,
  },
  {
    code: 'HR_OFFICER',
    name: 'HR Officer',
    description: 'Personnel records, leave policies, balances and HR reporting.',
    permissions: [
      ...SELF_SERVICE,
      P.SETTINGS_READ,
      P.MASTER_DATA_WRITE,
      P.USERS_READ,
      P.EMPLOYEES_READ,
      P.EMPLOYEES_WRITE,
      P.EMPLOYEES_SENSITIVE_READ,
      P.DOCUMENTS_MANAGE,
      P.LEAVE_READ_ANY,
      P.LEAVE_SUBMIT_ANY,
      P.LEAVE_APPROVE,
      P.LEAVE_ADJUST,
      P.LEAVE_POLICY_MANAGE,
      P.TIMESHEETS_READ_ANY,
      P.OVERTIME_READ_ANY,
      P.REPORTS_HR,
      P.REPORTS_EXPORT,
      P.IMPORTS_MANAGE,
      P.SUBSCRIPTION_READ,
    ],
    privileged: false,
  },
  {
    code: 'PAYROLL_OFFICER',
    name: 'Payroll Officer',
    description: 'Maintains payroll inputs, prepares payroll, generates outputs and submits delegated records.',
    permissions: [
      ...SELF_SERVICE,
      P.SETTINGS_READ,
      P.EMPLOYEES_READ,
      P.EMPLOYEES_SENSITIVE_READ,
      P.COMPENSATION_READ,
      P.COMPENSATION_WRITE,
      P.LEAVE_READ_ANY,
      P.LEAVE_SUBMIT_ANY,
      P.TIMESHEETS_READ_ANY,
      P.TIMESHEETS_SUBMIT_ANY,
      P.OVERTIME_READ_ANY,
      P.OVERTIME_SUBMIT_ANY,
      P.PAYROLL_CONFIG_MANAGE,
      P.STATUTORY_MANAGE,
      P.PAYROLL_READ,
      P.PAYROLL_PREPARE,
      P.PAYROLL_EXPORT,
      P.PAYSLIPS_PRINT_ANY,
      P.REPORTS_PAYROLL,
      P.REPORTS_EXPORT,
      P.IMPORTS_MANAGE,
      P.SUBSCRIPTION_READ,
    ],
    privileged: true,
  },
  {
    code: 'FINANCE_APPROVER',
    name: 'Finance Approver',
    description: 'Reviews and approves payroll and finance-related reports under configured authority.',
    permissions: [
      ...SELF_SERVICE,
      P.SETTINGS_READ,
      P.EMPLOYEES_READ,
      P.COMPENSATION_READ,
      P.PAYROLL_READ,
      P.PAYROLL_REVIEW,
      P.PAYROLL_APPROVE,
      P.PAYROLL_LOCK,
      P.PAYROLL_REVERSE,
      P.PAYROLL_EXPORT,
      P.STATUTORY_APPROVE,
      P.REPORTS_PAYROLL,
      P.REPORTS_EXPORT,
      P.SUBSCRIPTION_READ,
    ],
    privileged: true,
  },
  {
    code: 'MANAGER',
    name: 'Manager / Supervisor',
    description: 'Reviews team workflows; submits delegated leave, timesheets and overtime; prints approved payslips.',
    permissions: [
      ...SELF_SERVICE,
      P.EMPLOYEES_READ,
      P.LEAVE_READ_ANY,
      P.LEAVE_SUBMIT_ANY,
      P.LEAVE_APPROVE,
      P.TIMESHEETS_READ_ANY,
      P.TIMESHEETS_SUBMIT_ANY,
      P.TIMESHEETS_APPROVE,
      P.OVERTIME_READ_ANY,
      P.OVERTIME_SUBMIT_ANY,
      P.OVERTIME_APPROVE,
      P.PAYSLIPS_PRINT_ANY,
      P.REPORTS_HR,
    ],
    privileged: false,
  },
  {
    code: 'EMPLOYEE',
    name: 'Employee',
    description: 'Self-service: own profile, leave, eligible timesheets, overtime and payslips.',
    permissions: [...SELF_SERVICE],
    privileged: false,
  },
];

export interface PlatformRoleTemplate {
  code: PlatformRoleCode;
  name: string;
  permissions: PlatformPermission[];
}

export const PLATFORM_ROLE_TEMPLATES: PlatformRoleTemplate[] = [
  { code: 'PLATFORM_SUPER_ADMIN', name: 'Platform Super Admin', permissions: [...ALL_PLATFORM_PERMISSIONS] },
  {
    code: 'PLATFORM_LICENSING_OFFICER',
    name: 'Platform Licensing Officer',
    permissions: [
      PP.DASHBOARD,
      PP.CUSTOMERS_READ,
      PP.CUSTOMERS_WRITE,
      PP.PAYMENTS_READ,
      PP.PAYMENTS_RECORD,
      PP.PAYMENTS_VERIFY,
      PP.SUBSCRIPTIONS_READ,
      PP.SUBSCRIPTIONS_MANAGE,
      PP.CODES_ISSUE,
      PP.USAGE_READ,
      PP.AUDIT_READ,
    ],
  },
];

export function platformPermissionsFor(role: string | null | undefined): PlatformPermission[] {
  return PLATFORM_ROLE_TEMPLATES.find((r) => r.code === role)?.permissions ?? [];
}

export function hasPermission(granted: Iterable<string>, required: string | string[]): boolean {
  const set = granted instanceof Set ? (granted as Set<string>) : new Set(granted);
  const req = Array.isArray(required) ? required : [required];
  return req.every((r) => set.has(r));
}

export function hasAnyPermission(granted: Iterable<string>, options: string[]): boolean {
  const set = granted instanceof Set ? (granted as Set<string>) : new Set(granted);
  return options.some((r) => set.has(r));
}
