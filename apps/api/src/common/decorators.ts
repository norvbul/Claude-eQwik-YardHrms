import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FeatureCode } from '@yardhrms/authorization';
import type { AuthContext } from '../auth/auth-context';

export const META_PUBLIC = 'auth:public';
export const META_PLATFORM = 'auth:platform';
export const META_NO_TENANT = 'auth:no-tenant';
export const META_MFA_PENDING = 'auth:mfa-pending';
export const META_PERMISSIONS = 'auth:permissions';
export const META_ANY_PERMISSIONS = 'auth:any-permissions';
export const META_FEATURE = 'auth:feature';
export const META_ALLOW_READONLY = 'auth:allow-readonly';
export const META_RATE_LIMIT = 'auth:rate-limit';

/** No session required. Writes still pass Origin checks. */
export const Public = () => SetMetadata(META_PUBLIC, true);
/** Route belongs to the Qwik Licence Manager and requires a PLATFORM session. */
export const PlatformRoute = () => SetMetadata(META_PLATFORM, true);
/** Tenant session required but no active tenant needed (e.g. /me, switch tenant). */
export const AllowNoTenant = () => SetMetadata(META_NO_TENANT, true);
/** Reachable before MFA verification/enrollment is complete. */
export const AllowMfaPending = () => SetMetadata(META_MFA_PENDING, true);
/** Requires ALL listed permissions. */
export const Permissions = (...perms: string[]) => SetMetadata(META_PERMISSIONS, perms);
/** Requires at least ONE listed permission. */
export const AnyPermission = (...perms: string[]) => SetMetadata(META_ANY_PERMISSIONS, perms);
/** Requires the tenant plan to include the feature (licence entitlement layer). */
export const RequireFeature = (feature: FeatureCode) => SetMetadata(META_FEATURE, feature);
/** Write is permitted even when the subscription is expired/read-only (licence & onboarding actions). */
export const AllowReadOnly = () => SetMetadata(META_ALLOW_READONLY, true);
/** Per-route rate limit: max requests per window seconds per IP (+ key). */
export const RateLimit = (max: number, windowSeconds: number) => SetMetadata(META_RATE_LIMIT, { max, windowSeconds });

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest();
  return req.auth;
});
