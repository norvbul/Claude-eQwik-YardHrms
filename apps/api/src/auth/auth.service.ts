import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import type { Session } from '@prisma/client';
import { platformPermissionsFor } from '@yardhrms/authorization';
import { ErrorCodes, type MeResponse, type PlatformMeResponse, type RegisterInput } from '@yardhrms/types';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AppError, badRequest, businessRule, conflict, forbidden, unauthenticated } from '../common/errors';
import { RequestContext } from '../common/request-context';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningService } from '../tenancy/provisioning.service';
import type { AuthContext } from './auth-context';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

const LOCK_AFTER_FAILURES = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly provisioning: ProvisioningService,
    private readonly entitlements: EntitlementsService,
  ) {}

  // ── Email tokens ───────────────────────────────────────────────────────────
  private async issueToken(userId: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'INVITE', ttlHours: number, tenantId?: string) {
    const token = this.crypto.randomToken(32);
    await this.prisma.emailToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.emailToken.create({
      data: { userId, purpose, tenantId: tenantId ?? null, tokenHash: this.crypto.hmac(token), expiresAt: new Date(Date.now() + ttlHours * 3600_000) },
    });
    return token;
  }

  private async consumeToken(token: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'INVITE') {
    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash: this.crypto.hmac(token) } });
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) throw badRequest('This link is invalid or has expired. Request a new one.');
    const res = await this.prisma.emailToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (res.count !== 1) throw badRequest('This link has already been used');
    return row;
  }

  async sendVerification(userId: string, email: string) {
    const token = await this.issueToken(userId, 'EMAIL_VERIFY', 48);
    const url = `${this.config.HRMS_WEB_URL}/verify-email?token=${encodeURIComponent(token)}`;
    const { text, html } = this.mail.layout('Verify your email address', ['Welcome to eQwik YardHRMS™. Confirm your email address to activate your account.'], { label: 'Verify email', url });
    await this.mail.send({ to: email, subject: 'Verify your eQwik YardHRMS email', template: 'email_verify', text, html });
  }

  // ── Registration (PRD §5.1) ───────────────────────────────────────────────
  async register(input: RegisterInput) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      // Avoid account enumeration: respond identically but notify the existing account holder.
      const { text, html } = this.mail.layout('Registration attempt', [
        'Someone tried to register a new company with your email address. If this was you, sign in instead — you can be a member of several organizations.',
      ]);
      await this.mail.send({ to: input.email, subject: 'eQwik YardHRMS registration attempt', template: 'register_existing', text, html });
      return { status: 'VERIFICATION_SENT' as const };
    }
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.prisma.tx(async (tx) => {
      const u = await tx.user.create({ data: { email: input.email, fullName: input.fullName, passwordHash } });
      await this.provisioning.provisionTenant(tx, {
        legalName: input.companyLegalName,
        displayName: input.companyDisplayName,
        adminUserId: u.id,
        email: input.email,
        contactName: input.fullName,
      });
      return u;
    });
    await this.sendVerification(user.id, user.email);
    return { status: 'VERIFICATION_SENT' as const };
  }

  async verifyEmail(token: string) {
    const row = await this.consumeToken(token, 'EMAIL_VERIFY');
    await this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.record({ action: 'user.email_verified', entityType: 'User', entityId: row.userId, actorUserId: row.userId, scope: 'SYSTEM' });
    return { verified: true };
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) await this.sendVerification(user.id, user.email);
    return { status: 'SENT_IF_ELIGIBLE' };
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async login(res: Response, email: string, password: string, kind: 'TENANT' | 'PLATFORM') {
    const ctx = RequestContext.get();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const logEvent = (success: boolean, reason?: string) =>
      this.prisma.loginEvent.create({ data: { userId: user?.id, email, kind, success, reason, ip: ctx?.ip?.slice(0, 64), userAgent: ctx?.userAgent } });

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await logEvent(false, 'LOCKED');
      throw new AppError(ErrorCodes.RATE_LIMITED, `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes or reset your password.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const ok = await this.passwords.verify(user?.passwordHash, password);
    if (!user || !ok) {
      if (user) {
        const failed = user.failedLoginCount + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: failed, lockedUntil: failed >= LOCK_AFTER_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
        });
      }
      await logEvent(false, 'BAD_CREDENTIALS');
      throw unauthenticated('Email or password is incorrect');
    }
    if (user.status !== 'ACTIVE') {
      await logEvent(false, 'DISABLED');
      throw unauthenticated('Your account is disabled');
    }
    if (kind === 'PLATFORM' && !user.platformRole) {
      await logEvent(false, 'NOT_PLATFORM_STAFF');
      throw unauthenticated('Email or password is incorrect');
    }
    if (!user.emailVerifiedAt) {
      await logEvent(false, 'EMAIL_NOT_VERIFIED');
      throw new AppError(ErrorCodes.FORBIDDEN, 'Verify your email address before signing in. Check your inbox or request a new link.', HttpStatus.FORBIDDEN, { reason: 'EMAIL_NOT_VERIFIED' });
    }

    let tenantId: string | null = null;
    if (kind === 'TENANT') {
      const memberships = await this.prisma.tenantMembership.findMany({ where: { userId: user.id, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
      if (memberships.length === 1) tenantId = memberships[0].tenantId;
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const session = await this.sessions.create(res, { kind, userId: user.id, tenantId, mfaVerified: false });
    await logEvent(true);
    return { mfaRequired: !!user.mfaEnabledAt, sessionId: session.id };
  }

  async logout(res: Response, auth: AuthContext) {
    await this.sessions.revoke(auth.session.id);
    this.sessions.clearCookie(res, auth.kind);
    return { signedOut: true };
  }

  // ── MFA ───────────────────────────────────────────────────────────────────
  async mfaChallenge(res: Response, auth: AuthContext, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!user.mfaEnabledAt) throw businessRule('MFA is not enabled for this account');
    const hit = await this.prisma.loginEvent.count({ where: { userId: user.id, reason: 'MFA_FAILED', createdAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
    if (hit >= 10) throw new AppError(ErrorCodes.RATE_LIMITED, 'Too many incorrect codes. Sign in again later.', HttpStatus.TOO_MANY_REQUESTS);
    if (!this.mfa.verify(user.mfaSecretEnc, code)) {
      await this.prisma.loginEvent.create({ data: { userId: user.id, email: user.email, kind: auth.kind, success: false, reason: 'MFA_FAILED' } });
      throw unauthenticated('The authenticator code is incorrect');
    }
    await this.sessions.rotate(res, auth.session, { mfaVerified: true });
    return { mfaVerified: true };
  }

  async mfaSetupStart(auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (user.mfaEnabledAt) throw conflict('MFA is already enabled');
    const secret = this.mfa.generateSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaSecretEnc: this.crypto.encrypt(secret) } });
    return this.mfa.enrollmentPayload(user.email, secret);
  }

  async mfaSetupConfirm(res: Response, auth: AuthContext, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (user.mfaEnabledAt) throw conflict('MFA is already enabled');
    if (!user.mfaSecretEnc || !this.mfa.verify(user.mfaSecretEnc, code)) throw badRequest('The authenticator code is incorrect. Check your device time and try again.');
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date() } });
    await this.sessions.revokeAllForUser(user.id, auth.session.id);
    await this.sessions.rotate(res, auth.session, { mfaVerified: true });
    await this.audit.record({ tenantId: auth.tenantId, scope: auth.kind === 'PLATFORM' ? 'PLATFORM' : 'TENANT', action: 'user.mfa_enabled', entityType: 'User', entityId: user.id });
    return { mfaEnabled: true };
  }

  // ── Password reset / change ───────────────────────────────────────────────
  async forgotPassword(email: string, kind: 'TENANT' | 'PLATFORM') {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.status === 'ACTIVE' && (kind === 'TENANT' || user.platformRole)) {
      const token = await this.issueToken(user.id, 'PASSWORD_RESET', 1);
      const base = kind === 'PLATFORM' ? this.config.ADMIN_WEB_URL : this.config.HRMS_WEB_URL;
      const url = `${base}/reset-password?token=${encodeURIComponent(token)}`;
      const { text, html } = this.mail.layout('Reset your password', ['A password reset was requested for your account. The link expires in 1 hour. If you did not request this, ignore this email.'], {
        label: 'Reset password',
        url,
      });
      await this.mail.send({ to: user.email, subject: 'Reset your eQwik YardHRMS password', template: 'password_reset', text, html });
    }
    return { status: 'SENT_IF_EXISTS' };
  }

  async resetPassword(token: string, password: string) {
    const row = await this.consumeToken(token, 'PASSWORD_RESET');
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: new Date() } });
    await this.sessions.revokeAllForUser(row.userId);
    await this.audit.record({ action: 'user.password_reset', entityType: 'User', entityId: row.userId, actorUserId: row.userId, scope: 'SYSTEM' });
    return { reset: true };
  }

  async changePassword(auth: AuthContext, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await this.passwords.verify(user.passwordHash, current))) throw badRequest('Current password is incorrect');
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.passwords.hash(next) } });
    await this.sessions.revokeAllForUser(user.id, auth.session.id);
    await this.audit.record({ tenantId: auth.tenantId, action: 'user.password_changed', entityType: 'User', entityId: user.id });
    return { changed: true };
  }

  // ── Tenant selection ──────────────────────────────────────────────────────
  async switchTenant(res: Response, auth: AuthContext, tenantId: string) {
    const membership = await this.prisma.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId: auth.user.id } } });
    if (!membership || membership.status !== 'ACTIVE') throw forbidden('You are not an active member of that organization');
    await this.sessions.rotate(res, auth.session, { tenantId });
    await this.audit.record({ tenantId, action: 'session.tenant_selected', entityType: 'Session', entityId: auth.session.id });
    return { tenantId };
  }

  // ── Invitations ───────────────────────────────────────────────────────────
  async invitePreview(token: string) {
    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash: this.crypto.hmac(token) }, include: { user: true } });
    if (!row || row.purpose !== 'INVITE' || row.usedAt || row.expiresAt < new Date() || !row.tenantId) throw badRequest('This invitation is invalid or has expired');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: row.tenantId }, select: { displayName: true } });
    return { email: row.user.email, fullName: row.user.fullName, tenantName: tenant?.displayName, needsPassword: !row.user.passwordHash };
  }

  async acceptInvite(token: string, fullName?: string, password?: string) {
    const row = await this.consumeToken(token, 'INVITE');
    if (!row.tenantId) throw badRequest('Invalid invitation');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
    if (!user.passwordHash && !password) throw badRequest('Choose a password to activate your account');
    await this.prisma.tx(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date(), ...(password && !user.passwordHash ? { passwordHash: await this.passwords.hash(password) } : {}), ...(fullName ? { fullName } : {}) },
      });
      const m = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId: row.tenantId!, userId: user.id } } });
      if (!m || m.status !== 'INVITED') throw badRequest('This invitation is no longer valid');
      await tx.tenantMembership.update({ where: { id: m.id }, data: { status: 'ACTIVE' } });
      await this.audit.record({ tenantId: row.tenantId, action: 'membership.invite_accepted', entityType: 'TenantMembership', entityId: m.id, actorUserId: user.id }, tx);
    });
    return { accepted: true, email: user.email };
  }

  // ── Session description ───────────────────────────────────────────────────
  async me(auth: AuthContext): Promise<MeResponse> {
    const memberships = await this.prisma.tenantMembership.findMany({
      where: { userId: auth.user.id, status: 'ACTIVE' },
      include: { tenant: { select: { id: true, displayName: true, slug: true } }, roles: { include: { role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    let activeTenant: MeResponse['activeTenant'] = null;
    let entitlements: MeResponse['entitlements'] = null;
    if (auth.tenantId) {
      const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
      activeTenant = {
        id: t.id,
        displayName: t.displayName,
        legalName: t.legalName,
        logoUrl: t.logoKey ? `/api/v1/tenants/current/logo?v=${t.updatedAt.getTime()}` : null,
        accentColor: t.accentColor,
        roles: auth.roles,
        permissions: [...auth.permissions].sort(),
        employeeId: auth.employeeId,
      };
      entitlements = await this.entitlements.summary(auth.tenantId);
    }
    const privileged = memberships.find((m) => m.tenantId === auth.tenantId)?.roles.map((r) => r.role.privileged) ?? [];
    const mfaRequired = this.mfa.isRequired('TENANT', auth.roles, privileged);
    return {
      user: { id: auth.user.id, email: auth.user.email, fullName: auth.user.fullName, emailVerified: !!auth.user.emailVerifiedAt, mfaEnabled: !!auth.user.mfaEnabledAt },
      mfaVerified: auth.session.mfaVerified,
      mfaRequired: !!auth.user.mfaEnabledAt && !auth.session.mfaVerified,
      mfaSetupRequired: mfaRequired && !auth.user.mfaEnabledAt,
      memberships: memberships.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenant.displayName, tenantSlug: m.tenant.slug, roles: m.roles.map((r) => r.role.code), status: m.status })),
      activeTenant,
      entitlements,
      csrfToken: auth.session.csrfToken,
    };
  }

  platformMe(auth: AuthContext): PlatformMeResponse {
    return {
      user: { id: auth.user.id, email: auth.user.email, fullName: auth.user.fullName, emailVerified: !!auth.user.emailVerifiedAt, mfaEnabled: !!auth.user.mfaEnabledAt },
      platformRole: auth.user.platformRole!,
      permissions: platformPermissionsFor(auth.user.platformRole),
      mfaVerified: auth.session.mfaVerified,
      mfaSetupRequired: !auth.user.mfaEnabledAt,
      csrfToken: auth.session.csrfToken,
    };
  }

  sessionCsrf(session: Session) {
    return { csrfToken: session.csrfToken };
  }
}
