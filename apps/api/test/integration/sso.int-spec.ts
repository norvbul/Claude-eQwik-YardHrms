import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';
import { Client, TestContext, bootstrap, registerTenant } from './helpers';

/** Minimal OpenID provider: discovery, JWKS, token endpoint with PKCE verification. */
let server: http.Server;
let base = '';
let privateKey: KeyLike;
const codes = new Map<string, { claims: Record<string, unknown>; nonce: string; challenge: string; clientId: string; iss: string }>();

async function startIdp() {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, base);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      const ms = url.pathname.startsWith('/ms');
      return json(200, { issuer: ms ? `${base}/ms/{tenantid}/v2.0` : base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks` });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const entry = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      if (!entry || form.get('client_id') !== entry.clientId) return json(400, { error: 'invalid_grant' });
      const verifier = form.get('code_verifier') ?? '';
      if (createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
      const idToken = await new SignJWT({ ...entry.claims, nonce: entry.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(entry.iss)
        .setAudience(entry.clientId)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      return json(200, { id_token: idToken, token_type: 'Bearer' });
    }
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('Single sign-on (SEC-002)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    await startIdp();
    process.env.OIDC_GOOGLE_CLIENT_ID = 'google-client';
    process.env.OIDC_GOOGLE_CLIENT_SECRET = 'google-secret';
    process.env.OIDC_GOOGLE_ISSUER = base;
    process.env.OIDC_MICROSOFT_CLIENT_ID = 'ms-client';
    process.env.OIDC_MICROSOFT_CLIENT_SECRET = 'ms-secret';
    process.env.OIDC_MICROSOFT_ISSUER = `${base}/ms/organizations/v2.0`;
    ctx = await bootstrap();
  });
  afterAll(async () => {
    await ctx.app.close();
    server.close();
    for (const k of ['OIDC_GOOGLE_CLIENT_ID', 'OIDC_GOOGLE_CLIENT_SECRET', 'OIDC_GOOGLE_ISSUER', 'OIDC_MICROSOFT_CLIENT_ID', 'OIDC_MICROSOFT_CLIENT_SECRET', 'OIDC_MICROSOFT_ISSUER']) delete process.env[k];
  });

  /** Drives the browser redirects: start → (IdP) → callback. Returns the final app location. */
  async function sso(client: Client, provider: 'google' | 'microsoft', claims: Record<string, unknown>, opts: { tamperState?: boolean; badNonce?: boolean; startUrl?: string } = {}) {
    let authorizeUrl = opts.startUrl;
    if (!authorizeUrl) {
      const start = await client.agent.get(`/api/v1/auth/sso/${provider}/start?next=/app/leave`).redirects(0);
      expect(start.status).toBe(302);
      authorizeUrl = start.headers.location;
    }
    const u = new URL(authorizeUrl);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const code = randomUUID();
    const tid = (claims.tid as string) ?? 'tenant-1';
    codes.set(code, {
      claims,
      nonce: opts.badNonce ? 'other' : u.searchParams.get('nonce')!,
      challenge: u.searchParams.get('code_challenge')!,
      clientId: u.searchParams.get('client_id')!,
      iss: provider === 'microsoft' ? `${base}/ms/${tid}/v2.0` : base,
    });
    const state = opts.tamperState ? 'forged' : u.searchParams.get('state');
    const cb = await client.agent.get(`/api/v1/auth/sso/${provider}/callback?code=${code}&state=${state}`).redirects(0);
    expect(cb.status).toBe(302);
    return cb.headers.location as string;
  }

  it('lists configured providers', async () => {
    const r = await new Client(ctx).agent.get('/api/v1/auth/sso/providers');
    expect(r.body.data).toEqual([
      { id: 'google', name: 'Google' },
      { id: 'microsoft', name: 'Microsoft' },
    ]);
  });

  it('Google: verified email signs an existing user in; MFA still required; identity linked', async () => {
    const t = await registerTenant(ctx);
    const c = new Client(ctx);
    const loc = await sso(c, 'google', { sub: 'g-1', email: t.email.toUpperCase(), email_verified: true });
    expect(loc).toMatch(/\/sso\/complete\?next=%2Fapp%2Fleave$/);
    const me = await c.refreshCsrf();
    expect(me.status).toBe(200);
    expect((await c.get('/employees')).status).toBe(401); // MFA challenge first
    await c.completeMfa(t.secret);
    expect((await c.get('/employees')).status).toBe(200);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: t.email } });
    expect(await ctx.prisma.userIdentity.count({ where: { userId: user.id, provider: 'google', subject: 'g-1' } })).toBe(1);
    expect(await ctx.prisma.loginEvent.count({ where: { userId: user.id, reason: 'SSO_GOOGLE', success: true } })).toBe(1);
  });

  it('refuses unverified emails, unknown accounts, forged state and bad nonce', async () => {
    const t = await registerTenant(ctx);
    expect(await sso(new Client(ctx), 'google', { sub: 'g-2', email: t.email, email_verified: false })).toMatch(/login\?sso_error=email_not_verified/);
    expect(await sso(new Client(ctx), 'google', { sub: 'g-3', email: 'nobody@example.test', email_verified: true })).toMatch(/sso_error=no_account/);
    expect(await sso(new Client(ctx), 'google', { sub: 'g-4', email: t.email, email_verified: true }, { tamperState: true })).toMatch(/sso_error=invalid_state/);
    expect(await sso(new Client(ctx), 'google', { sub: 'g-5', email: t.email, email_verified: true }, { badNonce: true })).toMatch(/sso_error=invalid_token/);
    expect(await ctx.prisma.userIdentity.count({ where: { subject: { in: ['g-2', 'g-3', 'g-4', 'g-5'] } } })).toBe(0);
  });

  it('Microsoft: unverified-domain emails need explicit linking from a signed-in session', async () => {
    const t = await registerTenant(ctx);
    const claims = { sub: 'pairwise', oid: 'oid-7', tid: 'contoso', preferred_username: t.email };
    expect(await sso(new Client(ctx), 'microsoft', claims)).toMatch(/sso_error=link_required/);
    // signed-in admin links the identity
    const link = await t.admin.post('/auth/sso/microsoft/link');
    expect(link.status).toBe(200);
    const linked = await sso(t.admin, 'microsoft', claims, { startUrl: link.body.data.url });
    expect(linked).toMatch(/\/app\/account\?sso_linked=microsoft$/);
    // now a fresh browser can sign in with Microsoft
    expect(await sso(new Client(ctx), 'microsoft', claims)).toMatch(/\/sso\/complete/);
    const ids = await t.admin.get('/auth/sso/identities');
    expect(ids.body.data.map((i: any) => i.provider)).toEqual(['microsoft']);
    // a verified-domain Microsoft token for another user links automatically
    const t2 = await registerTenant(ctx);
    expect(await sso(new Client(ctx), 'microsoft', { oid: 'oid-8', tid: 'contoso', email: t2.email, xms_edov: true })).toMatch(/\/sso\/complete/);
    // the same identity cannot be linked to a different account
    const steal = await t2.admin.post('/auth/sso/microsoft/link');
    expect(await sso(t2.admin, 'microsoft', claims, { startUrl: steal.body.data.url })).toMatch(/account\?sso_error=identity_in_use/);
    // unlink (user has a password)
    expect((await t.admin.delete(`/auth/sso/identities/${ids.body.data[0].id}`)).status).toBe(200);
  });

  it('an invited user can accept by signing in with Google; the invitation becomes active', async () => {
    const t = await registerTenant(ctx);
    const inv = await t.admin.post('/users/invite', { email: 'invitee.sso@example.test', fullName: 'Invited Person', roleCodes: ['EMPLOYEE'] });
    expect(inv.status).toBe(201);
    const c = new Client(ctx);
    expect(await sso(c, 'google', { sub: 'g-inv', email: 'invitee.sso@example.test', email_verified: true })).toMatch(/\/sso\/complete/);
    const m = await ctx.prisma.tenantMembership.findFirstOrThrow({ where: { tenantId: t.tenantId, user: { email: 'invitee.sso@example.test' } } });
    expect(m.status).toBe('ACTIVE');
    await c.refreshCsrf();
    expect((await c.get('/auth/me')).body.data.activeTenant.id).toBe(t.tenantId);
  });
});
