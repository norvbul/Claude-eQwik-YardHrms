import type { Session, User } from '@prisma/client';
import type { Entitlements } from '../entitlements/entitlements.service';
import { forbidden } from '../common/errors';

export interface AuthContext {
  session: Session;
  user: Pick<User, 'id' | 'email' | 'fullName' | 'mfaEnabledAt' | 'emailVerifiedAt' | 'platformRole' | 'status'>;
  kind: 'TENANT' | 'PLATFORM';
  /** Active tenant resolved from the session + an ACTIVE membership; never from request input. */
  tenantId: string | null;
  membershipId: string | null;
  /** Employee record linked to the membership (self-service subject). */
  employeeId: string | null;
  roles: string[];
  permissions: Set<string>;
  entitlements: Entitlements | null;
}

export type TenantAuth = AuthContext & { tenantId: string; membershipId: string };

export function requireTenant(auth: AuthContext): TenantAuth {
  if (!auth?.tenantId || !auth.membershipId) throw forbidden('Select an organization first');
  return auth as TenantAuth;
}

export function can(auth: AuthContext, permission: string): boolean {
  return auth.permissions.has(permission);
}
