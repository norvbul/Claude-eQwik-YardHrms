import { Inject, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { TENANT_ROLE_TEMPLATES } from '@yardhrms/authorization';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { CryptoService } from '../common/crypto.service';

authenticator.options = { window: 1, step: 30, digits: 6 };

const PRIVILEGED_ROLE_CODES = new Set(TENANT_ROLE_TEMPLATES.filter((r) => r.privileged).map((r) => r.code));

/** TOTP multi-factor authentication (SEC-006). Secrets are stored AES-GCM encrypted. */
@Injectable()
export class MfaService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
  ) {}

  generateSecret(): string {
    return authenticator.generateSecret(20);
  }

  async enrollmentPayload(email: string, secret: string) {
    const otpauth = authenticator.keyuri(email, this.config.MFA_ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
    return { otpauth, qrDataUrl, secret };
  }

  verify(secretEnc: string | null | undefined, code: string): boolean {
    const secret = this.crypto.decryptNullable(secretEnc);
    if (!secret) return false;
    try {
      return authenticator.verify({ token: code, secret });
    } catch {
      return false;
    }
  }

  /** Whether MFA is mandatory for this context. Qwik staff always; tenant privileged roles when enforced. */
  isRequired(kind: 'TENANT' | 'PLATFORM', roleCodes: string[], privilegedRoleFlags: boolean[] = []): boolean {
    if (kind === 'PLATFORM') return true;
    if (this.config.MFA_ENFORCEMENT !== 'required') return false;
    return roleCodes.some((c) => PRIVILEGED_ROLE_CODES.has(c as any)) || privilegedRoleFlags.some(Boolean);
  }
}
