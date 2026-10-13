import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/config';

const ENC_VERSION = 'v1';

/**
 * Field-level encryption (AES-256-GCM) for sensitive identifiers and bank accounts (NFR-001, SEC-007),
 * and keyed hashing (HMAC-SHA256) for session tokens, email tokens and activation codes.
 */
@Injectable()
export class CryptoService {
  private readonly encKey: Buffer;
  private readonly hmacKey: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.encKey = Buffer.from(config.FIELD_ENCRYPTION_KEY, 'base64').subarray(0, 32);
    this.hmacKey = Buffer.from(config.TOKEN_HMAC_KEY, 'base64');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [ENC_VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const [ver, ivB, tagB, ctB] = payload.split(':');
    if (ver !== ENC_VERSION || !ivB || !tagB || ctB === undefined) throw new Error('Unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  }

  encryptNullable(v: string | null | undefined): string | null {
    return v ? this.encrypt(v) : null;
  }

  decryptNullable(v: string | null | undefined): string | null {
    if (!v) return null;
    try {
      return this.decrypt(v);
    } catch {
      return null;
    }
  }

  hmac(value: string): string {
    return createHmac('sha256', this.hmacKey).update(value).digest('hex');
  }

  sha256(data: Buffer | string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  randomHex(bytes = 32): string {
    return randomBytes(bytes).toString('hex');
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }

  /**
   * Activation code: 25 random characters from an unambiguous alphabet (≈125 bits of entropy),
   * formatted QWK-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX. Uses rejection sampling to avoid modulo bias.
   */
  activationCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars
    const chars: string[] = [];
    while (chars.length < 25) {
      for (const b of randomBytes(32)) {
        if (chars.length >= 25) break;
        chars.push(alphabet[b & 31]);
      }
    }
    const groups = [0, 5, 10, 15, 20].map((i) => chars.slice(i, i + 5).join(''));
    return `QWK-${groups.join('-')}`;
  }

  normalizeActivationCode(code: string): string {
    return code.trim().toUpperCase().replace(/\s+/g, '');
  }
}

export function last4(v: string | null | undefined): string | null {
  if (!v) return null;
  const digits = v.replace(/[^0-9A-Za-z]/g, '');
  return digits.slice(-4);
}

export function mask(last: string | null | undefined): string | null {
  return last ? `•••• ${last}` : null;
}
