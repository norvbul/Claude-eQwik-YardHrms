import { Injectable } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';

/** Argon2id password hashing (SEC-001) with OWASP-recommended parameters. */
@Injectable()
export class PasswordService {
  private readonly opts = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
  /** Pre-computed hash used to equalize timing when the account does not exist. */
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, this.opts);
  }

  async verify(hashValue: string | null | undefined, password: string): Promise<boolean> {
    if (!hashValue) {
      this.dummyHash ??= this.hash('timing-equalizer-not-a-password');
      await verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await verify(hashValue, password);
    } catch {
      return false;
    }
  }
}
