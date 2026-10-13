import { randomBytes } from 'node:crypto';
import { redact } from '../../src/audit/audit.service';
import { CryptoService } from '../../src/common/crypto.service';
import type { AppConfig } from '../../src/config/config';
import { toCsv } from '../../src/reports/export.util';
import { sniffContentType } from '../../src/storage/storage.service';

const crypto = new CryptoService({ FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), TOKEN_HMAC_KEY: randomBytes(32).toString('base64') } as AppConfig);

describe('field encryption (SEC-007, NFR-001)', () => {
  it('round-trips with a fresh IV each time and detects tampering', () => {
    const a = crypto.encrypt('123456789');
    const b = crypto.encrypt('123456789');
    expect(a).not.toEqual(b);
    expect(crypto.decrypt(a)).toBe('123456789');
    const parts = a.split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff;
    expect(() => crypto.decrypt([...parts.slice(0, 3), ct.toString('base64')].join(':'))).toThrow();
    expect(crypto.decryptNullable('garbage')).toBeNull();
  });

  it('a different key cannot decrypt', () => {
    const other = new CryptoService({ FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), TOKEN_HMAC_KEY: randomBytes(32).toString('base64') } as AppConfig);
    expect(() => other.decrypt(crypto.encrypt('secret'))).toThrow();
  });

  it('HMACs are deterministic per key (tokens and codes are stored only as HMACs)', () => {
    expect(crypto.hmac('code')).toBe(crypto.hmac('code'));
    expect(crypto.hmac('code')).not.toBe(crypto.hmac('code2'));
  });
});

describe('audit redaction (NFR-005)', () => {
  it('never stores secrets or identifiers in audit before/after values', () => {
    const out = redact({
      firstName: 'Omar',
      trn: '123456789',
      nisNumber: 'A123',
      passwordHash: 'x',
      mfaSecretEnc: 'y',
      bank: { accountNumber: '0001112222', bankName: 'NCB' },
      employeeNumber: 'EMP-0001',
      planCode: 'PRO',
      tokenHash: 'z',
    }) as Record<string, any>;
    expect(out).toMatchObject({ firstName: 'Omar', trn: '[REDACTED]', nisNumber: '[REDACTED]', passwordHash: '[REDACTED]', mfaSecretEnc: '[REDACTED]', employeeNumber: 'EMP-0001', planCode: 'PRO', tokenHash: '[REDACTED]' });
    expect(out.bank).toEqual({ accountNumber: '[REDACTED]', bankName: 'NCB' });
  });
});

describe('upload content sniffing (NFR-007)', () => {
  it('trusts file bytes, not the declared type', () => {
    expect(sniffContentType(Buffer.from('%PDF-1.7 ...'), 'image/png', 'x.png')).toBe('application/pdf');
    expect(sniffContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]), 'application/pdf', 'x.pdf')).toBe('image/png');
    expect(sniffContentType(Buffer.from('<script>alert(1)</script>'), 'image/png', 'evil.png')).toBe('unverified:image/png');
    expect(sniffContentType(Buffer.from([0x4d, 0x5a, 0x00, 0x00]), 'text/csv', 'data.csv')).toBe('application/octet-stream-binary');
    expect(sniffContentType(Buffer.from('a,b\n1,2\n'), 'text/plain', 'data.csv')).toBe('text/csv');
  });
});

describe('CSV export formula-injection protection (IMP-006)', () => {
  it('prefixes cells that a spreadsheet would execute, keeps numbers intact', () => {
    const csv = toCsv({ title: 't', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] as any, rows: [{ a: '=HYPERLINK("http://x")', b: '-1200.50' }, { a: '@SUM(A1)', b: '+cmd' }] }).toString('utf8');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")",-1200.50`);
    expect(csv).toContain(`'@SUM(A1),'+cmd`);
  });
});
