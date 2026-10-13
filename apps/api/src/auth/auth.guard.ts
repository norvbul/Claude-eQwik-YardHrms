import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { platformPermissionsFor, type FeatureCode } from '@yardhrms/authorization';
import { ErrorCodes } from '@yardhrms/types';
import { APP_CONFIG, type AppConfig } from '../config/config';
import {
  META_ALLOW_READONLY,
  META_ANY_PERMISSIONS,
  META_FEATURE,
  META_MFA_PENDING,
  META_NO_TENANT,
  META_PERMISSIONS,
  META_PLATFORM,
  META_PUBLIC,
  META_RATE_LIMIT,
} from '../common/decorators';
import { AppError, forbidden, unauthenticated } from '../common/errors';
import { RateLimitService } from '../common/rate-limit.service';
import { RequestContext } from '../common/request-context';
import { CryptoService } from '../common/crypto.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from './auth-context';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Single global guard enforcing, in order: rate limits → Origin/CSRF → session → MFA → tenant
 * membership (tenant resolved ONLY from the session + ACTIVE membership) → licence state/features → RBAC.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly mfa: MfaService,
    private readonly rateLimit: RateLimitService,
    private readonly crypto: CryptoService,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const method = req.method.toUpperCase();
    const safe = SAFE_METHODS.has(method);

    // 1. Rate limiting
    const rl = this.meta<{ max: number; windowSeconds: number }>(META_RATE_LIMIT, ctx);
    const routeKey = `${ctx.getClass().name}.${ctx.getHandler().name}`;
    const limit = rl ?? (safe ? { max: 600, windowSeconds: 60 } : { max: 120, windowSeconds: 60 });
    const hit = await this.rateLimit.hit(`${routeKey}:${req.ip}`, limit.max, limit.windowSeconds);
    if (!hit.allowed) {
      res.setHeader('Retry-After', String(hit.retryAfter));
      throw new AppError(ErrorCodes.RATE_LIMITED, 'Too many requests. Please wait and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }

    // 2. Public routes: Origin check on writes (cookie-less CSRF defence for login/register/reset)
    if (this.meta<boolean>(META_PUBLIC, ctx)) {
      if (!safe) this.checkOrigin(req);
      return true;
    }

    const kind: 'TENANT' | 'PLATFORM' = this.meta<boolean>(META_PLATFORM, ctx) ? 'PLATFORM' : 'TENANT';
    const session = await this.sessions.resolve(req, kind);
    if (!session) throw unauthenticated();

    // 3. CSRF: session-bound token required on every cookie-authenticated write
    if (!safe) {
      this.checkOrigin(req);
      const header = req.header('x-csrf-token') ?? '';
      if (!this.crypto.safeEqual(header, session.csrfToken)) {
        throw new AppError(ErrorCodes.CSRF_INVALID, 'Security token missing or invalid. Refresh the page and try again.', HttpStatus.FORBIDDEN);
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, fullName: true, mfaEnabledAt: true, emailVerifiedAt: true, platformRole: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      await this.sessions.revoke(session.id);
      throw unauthenticated('Your account is not active');
    }
    RequestContext.set({ userId: user.id, userEmail: user.email });

    const allowMfaPending = !!this.meta<boolean>(META_MFA_PENDING, ctx);
    const auth: AuthContext = {
      session,
      user,
      kind,
      tenantId: null,
      membershipId: null,
      employeeId: null,
      roles: [],
      permissions: new Set(),
      entitlements: null,
    };
    req.auth = auth;

    if (kind === 'PLATFORM') {
      if (!user.platformRole) throw forbidden('Qwik platform access only');
      auth.roles = [user.platformRole];
      auth.permissions = new Set(platformPermissionsFor(user.platformRole));
      this.enforceMfa(auth, true, allowMfaPending);
      this.enforcePermissions(ctx, auth);
      return true;
    }

    // 4. Tenant membership (never from client-supplied tenant ids)
    if (session.tenantId) {
      const membership = await this.prisma.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId: session.tenantId, userId: user.id } },
        include: { roles: { include: { role: { include: { permissions: true } } } } },
      });
      if (membership && membership.status === 'ACTIVE') {
        auth.tenantId = membership.tenantId;
        auth.membershipId = membership.id;
        auth.employeeId = membership.employeeId;
        auth.roles = membership.roles.map((r) => r.role.code);
        auth.permissions = new Set(membership.roles.flatMap((r) => r.role.permissions.map((p) => p.permissionCode)));
        RequestContext.set({ tenantId: membership.tenantId });
        const privileged = membership.roles.map((r) => r.role.privileged);
        this.enforceMfa(auth, this.mfa.isRequired('TENANT', auth.roles, privileged), allowMfaPending);
      }
    }
    if (!auth.tenantId) {
      this.enforceMfa(auth, false, allowMfaPending);
      if (!this.meta<boolean>(META_NO_TENANT, ctx)) {
        throw new AppError(ErrorCodes.TENANT_REQUIRED, 'Select an organization to continue', HttpStatus.FORBIDDEN);
      }
      this.enforcePermissions(ctx, auth);
      return true;
    }

    // 5. Licence entitlements (independent of RBAC)
    const ent = await this.entitlements.forTenant(auth.tenantId);
    auth.entitlements = ent;
    const allowReadOnly = !!this.meta<boolean>(META_ALLOW_READONLY, ctx) || !!this.meta<boolean>(META_NO_TENANT, ctx);
    if (ent.status === 'REVOKED' && !allowReadOnly) {
      throw new AppError(ErrorCodes.SUBSCRIPTION_LOCKED, 'This organization’s licence has been revoked. Contact Qwik Business Solutions support.', HttpStatus.PAYMENT_REQUIRED);
    }
    const feature = this.meta<FeatureCode>(META_FEATURE, ctx);
    if (feature) this.entitlements.assertFeature(ent, feature);
    if (!safe && !allowReadOnly) this.entitlements.assertWritable(ent);

    // 6. RBAC
    this.enforcePermissions(ctx, auth);
    return true;
  }

  private enforceMfa(auth: AuthContext, required: boolean, allowPending: boolean) {
    if (allowPending) return;
    if (auth.user.mfaEnabledAt && !auth.session.mfaVerified) {
      throw new AppError(ErrorCodes.MFA_REQUIRED, 'Enter your authenticator code to continue', HttpStatus.UNAUTHORIZED);
    }
    if (required && !auth.user.mfaEnabledAt) {
      throw new AppError(ErrorCodes.MFA_SETUP_REQUIRED, 'Multi-factor authentication must be set up for your role before continuing', HttpStatus.FORBIDDEN);
    }
  }

  private enforcePermissions(ctx: ExecutionContext, auth: AuthContext) {
    const all = this.meta<string[]>(META_PERMISSIONS, ctx);
    if (all?.length && !all.every((p) => auth.permissions.has(p))) {
      throw forbidden('You do not have permission to perform this action', { required: all });
    }
    const any = this.meta<string[]>(META_ANY_PERMISSIONS, ctx);
    if (any?.length && !any.some((p) => auth.permissions.has(p))) {
      throw forbidden('You do not have permission to perform this action', { requiredAny: any });
    }
  }

  private checkOrigin(req: Request) {
    const origin = req.header('origin');
    if (!origin) return; // non-browser clients (no ambient credentials via form posts)
    const self = `${req.protocol}://${req.get('host')}`;
    if (origin !== self && !this.config.corsOrigins.includes(origin)) {
      throw new AppError(ErrorCodes.CSRF_INVALID, 'Request origin not allowed', HttpStatus.FORBIDDEN);
    }
  }
}
