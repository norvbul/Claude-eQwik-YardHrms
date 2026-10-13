import { createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';
import { hash, Algorithm } from '@node-rs/argon2';
import type { Page } from '@playwright/test';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const HRMS = process.env.E2E_HRMS_URL ?? 'http://127.0.0.1:5173';
export const ADMIN = process.env.E2E_ADMIN_URL ?? 'http://127.0.0.1:5174';
export const PASSWORD = 'E2e!Password2026';

export const prisma = new PrismaClient();

const hmac = (v: string) => createHmac('sha256', Buffer.from(process.env.TOKEN_HMAC_KEY!, 'base64')).update(v).digest('hex');
export const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

/** Simulates clicking the emailed verification link (tokens are only ever stored hashed). */
export async function verificationLink(email: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const token = randomBytes(32).toString('base64url');
  await prisma.emailToken.create({ data: { userId: user.id, purpose: 'EMAIL_VERIFY', tokenHash: hmac(token), expiresAt: new Date(Date.now() + 3600_000) } });
  return `${HRMS}/verify-email?token=${encodeURIComponent(token)}`;
}

/** Creates a Qwik staff member with a known password and pre-enrolled TOTP secret. */
export async function createStaff(role: 'PLATFORM_SUPER_ADMIN' | 'PLATFORM_LICENSING_OFFICER') {
  const email = `${uniq('staff')}@qwik-e2e.test`;
  const secret = authenticator.generateSecret(20);
  const key = Buffer.from(process.env.FIELD_ENCRYPTION_KEY!, 'base64').subarray(0, 32);
  const { createCipheriv } = await import('node:crypto');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  const enc = ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
  await prisma.user.create({
    data: {
      email,
      fullName: `E2E ${role.includes('SUPER') ? 'Admin' : 'Officer'}`,
      passwordHash: await hash(PASSWORD, { algorithm: Algorithm.Argon2id }),
      emailVerifiedAt: new Date(),
      platformRole: role,
      mfaSecretEnc: enc,
      mfaEnabledAt: new Date(),
    },
  });
  return { email, secret };
}

export async function staffLogin(page: Page, staff: { email: string; secret: string }) {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel('Email').fill(staff.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Authenticator code').fill(authenticator.generate(staff.secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL(`${ADMIN}/`);
}

export const totp = (secret: string) => authenticator.generate(secret);
