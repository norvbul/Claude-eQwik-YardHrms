/**
 * Licence entitlements (PRD §7, LIC-010). Independent of RBAC: a feature being enabled on a plan
 * never grants a user permission, and a permission never bypasses a missing feature.
 */
export const Features = {
  EMPLOYEES: 'EMPLOYEES',
  LEAVE: 'LEAVE',
  TIMESHEETS: 'TIMESHEETS',
  OVERTIME: 'OVERTIME',
  PAYROLL: 'PAYROLL',
  PAYSLIPS: 'PAYSLIPS',
  BULK_IMPORT: 'BULK_IMPORT',
  ADVANCED_REPORTS: 'ADVANCED_REPORTS',
  AUDIT_VIEW: 'AUDIT_VIEW',
} as const;
export type FeatureCode = (typeof Features)[keyof typeof Features];

export const FEATURE_CATALOG: { code: FeatureCode; name: string; description: string }[] = [
  { code: 'EMPLOYEES', name: 'Employees / basic HR', description: 'Employee records, master data and self-service profile' },
  { code: 'LEAVE', name: 'Leave management', description: 'Leave types, requests, approvals and balances' },
  { code: 'TIMESHEETS', name: 'Regular timesheets', description: 'Weekly/fortnightly regular timesheets' },
  { code: 'OVERTIME', name: 'Overtime', description: 'Overtime requests and approvals' },
  { code: 'PAYROLL', name: 'Payroll', description: 'Payroll configuration, statutory rules and payroll runs' },
  { code: 'PAYSLIPS', name: 'Payslips', description: 'PDF payslips and secure distribution' },
  { code: 'BULK_IMPORT', name: 'Bulk imports', description: 'Excel/CSV employee and timesheet imports' },
  { code: 'ADVANCED_REPORTS', name: 'Advanced reporting', description: 'Payroll/statutory reports and exports' },
  { code: 'AUDIT_VIEW', name: 'Audit view', description: 'Tenant audit log viewer' },
];

export const SubscriptionStates = {
  PENDING_ACTIVATION: 'PENDING_ACTIVATION',
  FREE: 'FREE',
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  GRACE: 'GRACE',
  EXPIRED: 'EXPIRED',
  SUSPENDED: 'SUSPENDED',
  REVOKED: 'REVOKED',
  SUPERSEDED: 'SUPERSEDED',
} as const;
export type SubscriptionState = (typeof SubscriptionStates)[keyof typeof SubscriptionStates];

/** States in which ordinary business-data writes are blocked (read-only / locked mode). */
export const READ_ONLY_STATES: SubscriptionState[] = ['EXPIRED', 'SUSPENDED', 'REVOKED'];
/** States in which even historical reads are blocked except licence/onboarding pages. */
export const LOCKED_STATES: SubscriptionState[] = ['REVOKED'];

export interface SubscriptionTimeline {
  status: SubscriptionState;
  periodEnd: Date | null;
  graceEnd: Date | null;
}

/**
 * Computes the effective state of a subscription at `now` from its stored status and dates.
 * Persisted status may lag (the worker sweeps transitions); enforcement always uses this function.
 */
export function effectiveSubscriptionState(sub: SubscriptionTimeline, now: Date = new Date()): SubscriptionState {
  if (sub.status === 'ACTIVE' || sub.status === 'GRACE' || sub.status === 'TRIAL') {
    if (sub.periodEnd && now.getTime() > sub.periodEnd.getTime()) {
      if (sub.graceEnd && now.getTime() <= sub.graceEnd.getTime()) return 'GRACE';
      return 'EXPIRED';
    }
    return sub.status === 'GRACE' ? 'ACTIVE' : sub.status;
  }
  return sub.status;
}

export function isReadOnlyState(state: SubscriptionState): boolean {
  return READ_ONLY_STATES.includes(state);
}

export interface SeedPlan {
  code: string;
  name: string;
  isFree: boolean;
  employeeLimit: number;
  userLimit: number;
  durationMonths: number | null;
  gracePeriodDays: number;
  features: FeatureCode[];
  /**
   * Proposed annual price in JMD, GCT-exclusive (researched 2026-10-13 against local offerings; owner to
   * confirm). Applied only to plans whose price is still unset; never overwrites a price set by Qwik.
   */
  proposedPrice: string | null;
}

/**
 * PRD §7.1 recommended initial tiers with proposed annual JMD prices (see docs/pricing.md). All values
 * are editable in the Licence Manager and the seed never overwrites a price Qwik has set.
 */
export const SEED_PLANS: SeedPlan[] = [
  {
    code: 'FREE',
    name: 'Free',
    isFree: true,
    employeeLimit: 5,
    userLimit: 2,
    durationMonths: null,
    gracePeriodDays: 0,
    features: ['EMPLOYEES', 'LEAVE', 'TIMESHEETS'],
    proposedPrice: '0.00',
  },
  {
    code: 'STARTER',
    name: 'Starter',
    isFree: false,
    employeeLimit: 25,
    userLimit: 5,
    durationMonths: 12,
    gracePeriodDays: 14,
    features: ['EMPLOYEES', 'LEAVE', 'TIMESHEETS', 'OVERTIME', 'PAYROLL', 'PAYSLIPS'],
    proposedPrice: '95000.00',
  },
  {
    code: 'PROFESSIONAL',
    name: 'Professional',
    isFree: false,
    employeeLimit: 100,
    userLimit: 15,
    durationMonths: 12,
    gracePeriodDays: 14,
    features: ['EMPLOYEES', 'LEAVE', 'TIMESHEETS', 'OVERTIME', 'PAYROLL', 'PAYSLIPS', 'BULK_IMPORT', 'ADVANCED_REPORTS', 'AUDIT_VIEW'],
    proposedPrice: '295000.00',
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    isFree: false,
    employeeLimit: 250,
    userLimit: 30,
    durationMonths: 12,
    gracePeriodDays: 30,
    features: ['EMPLOYEES', 'LEAVE', 'TIMESHEETS', 'OVERTIME', 'PAYROLL', 'PAYSLIPS', 'BULK_IMPORT', 'ADVANCED_REPORTS', 'AUDIT_VIEW'],
    proposedPrice: '595000.00',
  },
];
