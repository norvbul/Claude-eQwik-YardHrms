import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto.service';
import { RequestContext } from '../common/request-context';
import { badRequest, notFound } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './session.service';

export type SsoProviderId = 'google' | 'microsoft';
const COOKIE = 'yh_sso';
const STATE_TTL_MS = 10 * 60_000;

interface ProviderCfg {
  id: SsoProviderId;
  name: string;
  clientId: string;
  clientSecret: string;
  discovery: string;
}
interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
interface FlowState {
  p: SsoProviderId;
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  link: string | null;
  exp: number;
}

export class SsoError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const b64url = (b: Buffer) => b.toString('base64url');
const safeNext = (n: unknown) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n.slice(0, 200) : '/app');

/**
 * SEC-002: Google and Microsoft sign-in with OpenID Connect (authorization code + PKCE, state, nonce,
 * signature/issuer/audience checks). SSO signs existing users in; it never creates companies or bypasses
 * MFA for privileged roles. Accounts are matched by a previously linked identity, or by email only when
 * the provider asserts the email is verified (Google `email_verified`; Microsoft `xms_edov`).
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger('SSO');
  private readonly discoveryCache = new Map<string, { doc: Discovery; at: number }>();
  private readonly jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  private providers(): ProviderCfg[] {
    const c = this.config;
    const out: ProviderCfg[] = [];
    if (c.OIDC_GOOGLE_CLIENT_ID && c.OIDC_GOOGLE_CLIENT_SECRET) {
      out.push({ id: 'google', name: 'Google', clientId: c.OIDC_GOOGLE_CLIENT_ID, clientSecret: c.OIDC_GOOGLE_CLIENT_SECRET, discovery: `${c.OIDC_GOOGLE_ISSUER.replace(/\/$/, '')}/.well-known/openid-configuration` });
    }
    if (c.OIDC_MICROSOFT_CLIENT_ID && c.OIDC_MICROSOFT_CLIENT_SECRET) {
      const base = c.OIDC_MICROSOFT_ISSUER ?? `https://login.microsoftonline.com/${encodeURIComponent(c.OIDC_MICROSOFT_TENANT)}/v2.0`;
      out.push({ id: 'microsoft', name: 'Microsoft', clientId: c.OIDC_MICROSOFT_CLIENT_ID, clientSecret: c.OIDC_MICROSOFT_CLIENT_SECRET, discovery: `${base.replace(/\/$/, '')}/.well-known/openid-configuration` });
    }
    return out;
  }

  enabledProviders() {
    return this.providers().map((p) => ({ id: p.id, name: p.name }));
  }

  private provider(id: string): ProviderCfg {
    const p = this.providers().find((x) => x.id === id);
    if (!p) throw notFound('Sign-in provider');
    return p;
  }

  private redirectUri(p: SsoProviderId) {
    return `${this.config.HRMS_WEB_URL.replace(/\/$/, '')}/api/v1/auth/sso/${p}/callback`;
  }

  private async discovery(p: ProviderCfg): Promise<Discovery> {
    const hit = this.discoveryCache.get(p.discovery);
    if (hit && Date.now() - hit.at < 3600_000) return hit.doc;
    const res = await fetch(p.discovery);
    if (!res.ok) throw new SsoError('provider_unavailable');
    const doc = (await res.json()) as Discovery;
    this.discoveryCache.set(p.discovery, { doc, at: Date.now() });
    return doc;
  }

  /** Builds the provider authorization URL and stores the flow state in an encrypted, short-lived cookie. */
  async start(res: Response, providerId: string, opts: { next?: unknown; linkUserId?: string | null }): Promise<string> {
    const p = this.provider(providerId);
    const doc = await this.discovery(p);
    const st: FlowState = {
      p: p.id,
      state: this.crypto.randomToken(24),
      nonce: this.crypto.randomToken(24),
      verifier: this.crypto.randomToken(48),
      next: safeNext(opts.next),
      link: opts.linkUserId ?? null,
      exp: Date.now() + STATE_TTL_MS,
    };
    res.cookie(COOKIE, this.crypto.encrypt(JSON.stringify(st)), { httpOnly: true, secure: this.config.COOKIE_SECURE, sameSite: 'lax', path: '/api/v1/auth/sso', maxAge: STATE_TTL_MS });
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: p.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri(p.id),
      scope: 'openid email profile',
      state: st.state,
      nonce: st.nonce,
      code_challenge: b64url(createHash('sha256').update(st.verifier).digest()),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  /** Handles the provider redirect. Returns the app URL to send the browser to. */
  async callback(req: Request, res: Response, providerId: string, q: { code?: string; state?: string; error?: string }): Promise<string> {
    const app = this.config.HRMS_WEB_URL.replace(/\/$/, '');
    let st: FlowState | null = null;
    try {
      const raw = req.cookies?.[COOKIE];
      res.clearCookie(COOKIE, { path: '/api/v1/auth/sso' });
      if (!raw) throw new SsoError('session_expired');
      st = JSON.parse(this.crypto.decrypt(raw)) as FlowState;
      if (st.p !== providerId || !q.state || st.state !== q.state || st.exp < Date.now()) throw new SsoError('invalid_state');
      if (q.error) throw new SsoError(q.error === 'access_denied' ? 'cancelled' : 'provider_error');
      if (!q.code) throw new SsoError('provider_error');
      const p = this.provider(providerId);
      const claims = await this.exchange(p, q.code, st);
      const ident = this.identityFrom(p.id, claims);
      if (st.link) {
        await this.link(st.link, p.id, ident);
        return `${app}/app/account?sso_linked=${p.id}`;
      }
      await this.signIn(res, p.id, ident);
      return `${app}/sso/complete?next=${encodeURIComponent(st.next)}`;
    } catch (e) {
      const code = e instanceof SsoError ? e.code : 'failed';
      if (!(e instanceof SsoError)) this.logger.warn(`SSO ${providerId} failed: ${(e as Error).message}`);
      const ctx = RequestContext.get();
      await this.prisma.loginEvent.create({ data: { email: '(sso)', kind: 'TENANT', success: false, reason: `SSO_${providerId.toUpperCase()}_${code.toUpperCase()}`.slice(0, 60), ip: ctx?.ip?.slice(0, 64), userAgent: ctx?.userAgent } }).catch(() => undefined);
      return st?.link ? `${app}/app/account?sso_error=${code}` : `${app}/login?sso_error=${code}`;
    }
  }

  private async exchange(p: ProviderCfg, code: string, st: FlowState): Promise<JWTPayload> {
    const doc = await this.discovery(p);
    const tokenRes = await fetch(doc.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri(p.id), client_id: p.clientId, client_secret: p.clientSecret, code_verifier: st.verifier }).toString(),
    });
    if (!tokenRes.ok) throw new SsoError('token_exchange_failed');
    const body = (await tokenRes.json()) as { id_token?: string };
    if (!body.id_token) throw new SsoError('token_exchange_failed');
    let jwks = this.jwks.get(doc.jwks_uri);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
      this.jwks.set(doc.jwks_uri, jwks);
    }
    // Microsoft's multi-tenant discovery issuer contains a {tenantid} placeholder.
    const unverified = decodeJwt(body.id_token);
    const issuer = doc.issuer.includes('{tenantid}') ? doc.issuer.replace('{tenantid}', String(unverified.tid ?? '')) : doc.issuer;
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(body.id_token, jwks, { audience: p.clientId, issuer, clockTolerance: 60 }));
    } catch {
      throw new SsoError('invalid_token');
    }
    if (payload.nonce !== st.nonce) throw new SsoError('invalid_token');
    if (p.id === 'microsoft' && this.config.OIDC_MICROSOFT_TENANT !== 'organizations' && this.config.OIDC_MICROSOFT_TENANT !== 'common' && payload.tid !== this.config.OIDC_MICROSOFT_TENANT) {
      throw new SsoError('directory_not_allowed');
    }
    return payload;
  }

  private identityFrom(p: SsoProviderId, c: JWTPayload): { subject: string; email: string; emailTrusted: boolean } {
    const email = String((c.email as string | undefined) ?? (p === 'microsoft' ? (c.preferred_username as string | undefined) : '') ?? '')
      .trim()
      .toLowerCase();
    if (!email || !email.includes('@')) throw new SsoError('no_email');
    if (p === 'google') return { subject: String(c.sub), email, emailTrusted: c.email_verified === true };
    const oid = c.oid ?? c.sub;
    return { subject: `${String(c.tid ?? '')}:${String(oid)}`, email, emailTrusted: c.xms_edov === true || c.xms_edov === '1' || c.xms_edov === 1 };
  }

  private async link(userId: string, provider: SsoProviderId, ident: { subject: string; email: string }) {
    const existing = await this.prisma.userIdentity.findUnique({ where: { provider_subject: { provider, subject: ident.subject } } });
    if (existing && existing.userId !== userId) throw new SsoError('identity_in_use');
    if (!existing) await this.prisma.userIdentity.create({ data: { userId, provider, subject: ident.subject, email: ident.email } });
    await this.audit.record({ scope: 'SYSTEM', action: 'user.sso_linked', entityType: 'User', entityId: userId, actorUserId: userId, metadata: { provider, email: ident.email } });
  }

  private async signIn(res: Response, provider: SsoProviderId, ident: { subject: string; email: string; emailTrusted: boolean }) {
    let identity = await this.prisma.userIdentity.findUnique({ where: { provider_subject: { provider, subject: ident.subject } }, include: { user: true } });
    let user = identity?.user ?? null;
    if (!user) {
      if (!ident.emailTrusted) throw new SsoError(provider === 'microsoft' ? 'link_required' : 'email_not_verified');
      user = await this.prisma.user.findUnique({ where: { email: ident.email } });
      if (!user) throw new SsoError('no_account');
      identity = await this.prisma.userIdentity.create({ data: { userId: user.id, provider, subject: ident.subject, email: ident.email }, include: { user: true } });
      await this.audit.record({ scope: 'SYSTEM', action: 'user.sso_linked', entityType: 'User', entityId: user.id, actorUserId: user.id, metadata: { provider, email: ident.email, automatic: true } });
    }
    if (user.status !== 'ACTIVE') throw new SsoError('account_disabled');
    // The provider proved control of the address: complete verification and any pending invitations.
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: user.emailVerifiedAt ?? now, lastLoginAt: now, failedLoginCount: 0, lockedUntil: null } }),
      this.prisma.tenantMembership.updateMany({ where: { userId: user.id, status: 'INVITED' }, data: { status: 'ACTIVE' } }),
      this.prisma.userIdentity.update({ where: { id: identity!.id }, data: { lastUsedAt: now } }),
    ]);
    const memberships = await this.prisma.tenantMembership.findMany({ where: { userId: user.id, status: 'ACTIVE' } });
    if (!memberships.length) throw new SsoError('no_organization');
    await this.sessions.create(res, { kind: 'TENANT', userId: user.id, tenantId: memberships.length === 1 ? memberships[0].tenantId : null, mfaVerified: false });
    const ctx = RequestContext.get();
    await this.prisma.loginEvent.create({ data: { userId: user.id, email: user.email, kind: 'TENANT', success: true, reason: `SSO_${provider.toUpperCase()}`, ip: ctx?.ip?.slice(0, 64), userAgent: ctx?.userAgent } });
  }

  async identities(userId: string) {
    return this.prisma.userIdentity.findMany({ where: { userId }, select: { id: true, provider: true, email: true, createdAt: true, lastUsedAt: true }, orderBy: { createdAt: 'asc' } });
  }

  async unlink(userId: string, id: string) {
    const identity = await this.prisma.userIdentity.findFirst({ where: { id, userId } });
    if (!identity) throw notFound('Linked sign-in');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { identities: true } });
    if (!user.passwordHash && user.identities.length <= 1) throw badRequest('Set a password before removing your only sign-in method');
    await this.prisma.userIdentity.delete({ where: { id } });
    await this.audit.record({ scope: 'SYSTEM', action: 'user.sso_unlinked', entityType: 'User', entityId: userId, actorUserId: userId, metadata: { provider: identity.provider } });
    return { removed: true };
  }
}
