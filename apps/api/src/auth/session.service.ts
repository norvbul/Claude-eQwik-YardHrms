import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Session } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContext } from '../common/request-context';

export const TENANT_COOKIE = 'yh_sid';
export const PLATFORM_COOKIE = 'qp_sid';

/**
 * Server-backed sessions (SEC-002). The cookie carries a random token; the DB stores only its HMAC.
 * Sessions expire absolutely (SESSION_TTL_HOURS) and on inactivity (SESSION_IDLE_MINUTES), and can be revoked.
 * Each login creates a fresh token (prevents session fixation); privilege changes rotate it.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  cookieName(kind: 'TENANT' | 'PLATFORM') {
    return kind === 'TENANT' ? TENANT_COOKIE : PLATFORM_COOKIE;
  }

  async create(res: Response, opts: { kind: 'TENANT' | 'PLATFORM'; userId: string; tenantId?: string | null; mfaVerified: boolean }): Promise<Session> {
    const token = this.crypto.randomToken(32);
    const ctx = RequestContext.get();
    const session = await this.prisma.session.create({
      data: {
        tokenHash: this.crypto.hmac(token),
        kind: opts.kind,
        userId: opts.userId,
        tenantId: opts.tenantId ?? null,
        csrfToken: this.crypto.randomHex(32),
        mfaVerified: opts.mfaVerified,
        ip: ctx?.ip?.slice(0, 64),
        userAgent: ctx?.userAgent,
        expiresAt: new Date(Date.now() + this.config.SESSION_TTL_HOURS * 3600_000),
      },
    });
    this.setCookie(res, opts.kind, token);
    return session;
  }

  setCookie(res: Response, kind: 'TENANT' | 'PLATFORM', token: string) {
    res.cookie(this.cookieName(kind), token, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: kind === 'PLATFORM' ? 'strict' : 'lax',
      path: '/',
      maxAge: this.config.SESSION_TTL_HOURS * 3600_000,
    });
  }

  clearCookie(res: Response, kind: 'TENANT' | 'PLATFORM') {
    res.clearCookie(this.cookieName(kind), { path: '/', httpOnly: true, secure: this.config.COOKIE_SECURE, sameSite: kind === 'PLATFORM' ? 'strict' : 'lax' });
  }

  async resolve(req: Request, kind: 'TENANT' | 'PLATFORM'): Promise<Session | null> {
    const token = req.cookies?.[this.cookieName(kind)];
    if (!token || typeof token !== 'string' || token.length > 200) return null;
    const session = await this.prisma.session.findUnique({ where: { tokenHash: this.crypto.hmac(token) } });
    if (!session || session.kind !== kind || session.revokedAt) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() < now || session.lastSeenAt.getTime() + this.config.SESSION_IDLE_MINUTES * 60_000 < now) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } }).catch(() => undefined);
      return null;
    }
    if (now - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
    return session;
  }

  async revoke(sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string) {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null, id: exceptSessionId ? { not: exceptSessionId } : undefined }, data: { revokedAt: new Date() } });
  }

  /** Rotates the session token (used after MFA verification and tenant switch). */
  async rotate(res: Response, session: Session, patch: Partial<Pick<Session, 'tenantId' | 'mfaVerified'>>): Promise<Session> {
    const token = this.crypto.randomToken(32);
    const updated = await this.prisma.session.update({
      where: { id: session.id },
      data: { tokenHash: this.crypto.hmac(token), lastSeenAt: new Date(), ...patch },
    });
    this.setCookie(res, session.kind, token);
    return updated;
  }
}
