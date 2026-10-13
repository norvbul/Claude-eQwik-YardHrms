import { describe, expect, it } from 'vitest';
import {
  TENANT_ROLE_TEMPLATES,
  TenantPermissions as P,
  effectiveSubscriptionState,
  hasPermission,
  platformPermissionsFor,
} from './index';

const role = (code: string) => TENANT_ROLE_TEMPLATES.find((r) => r.code === code)!;

describe('role templates', () => {
  it('grants delegated submission to Admin, Payroll Officer and Manager (PRD §4)', () => {
    for (const code of ['COMPANY_ADMIN', 'PAYROLL_OFFICER', 'MANAGER']) {
      const perms = role(code).permissions;
      expect(perms).toContain(P.LEAVE_SUBMIT_ANY);
      expect(perms).toContain(P.PAYSLIPS_PRINT_ANY);
    }
    expect(role('PAYROLL_OFFICER').permissions).toContain(P.TIMESHEETS_SUBMIT_ANY);
    expect(role('MANAGER').permissions).toContain(P.OVERTIME_SUBMIT_ANY);
  });

  it('does not grant payroll approval to the Payroll Officer (separation of duties)', () => {
    expect(role('PAYROLL_OFFICER').permissions).not.toContain(P.PAYROLL_APPROVE);
    expect(role('PAYROLL_OFFICER').permissions).not.toContain(P.TIMESHEETS_APPROVE);
  });

  it('employee is self-service only', () => {
    expect(role('EMPLOYEE').permissions.every((p) => p.endsWith('.self'))).toBe(true);
  });

  it('hasPermission requires all permissions', () => {
    expect(hasPermission(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(hasPermission(['a'], ['a', 'b'])).toBe(false);
  });

  it('platform roles never include tenant permissions', () => {
    expect(platformPermissionsFor('PLATFORM_LICENSING_OFFICER').every((p) => p.startsWith('platform.'))).toBe(true);
    expect(platformPermissionsFor('COMPANY_ADMIN')).toEqual([]);
  });
});

describe('effectiveSubscriptionState', () => {
  const day = 86_400_000;
  const now = new Date('2026-06-01T00:00:00Z');
  it('keeps active subscriptions active before period end', () => {
    expect(effectiveSubscriptionState({ status: 'ACTIVE', periodEnd: new Date(now.getTime() + day), graceEnd: null }, now)).toBe('ACTIVE');
  });
  it('moves to grace after period end and expired after grace', () => {
    const sub = { status: 'ACTIVE' as const, periodEnd: new Date(now.getTime() - day), graceEnd: new Date(now.getTime() + day) };
    expect(effectiveSubscriptionState(sub, now)).toBe('GRACE');
    expect(effectiveSubscriptionState({ ...sub, graceEnd: new Date(now.getTime() - 1) }, now)).toBe('EXPIRED');
  });
  it('free subscriptions never expire', () => {
    expect(effectiveSubscriptionState({ status: 'FREE', periodEnd: null, graceEnd: null }, now)).toBe('FREE');
  });
  it('suspended stays suspended', () => {
    expect(effectiveSubscriptionState({ status: 'SUSPENDED', periodEnd: null, graceEnd: null }, now)).toBe('SUSPENDED');
  });
});
