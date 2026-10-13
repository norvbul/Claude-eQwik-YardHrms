import { Inject, Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { badRequest } from '../common/errors';

export const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  document: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
  logo: ['image/png', 'image/jpeg', 'image/webp'],
  spreadsheet: [
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream',
    'text/plain',
  ],
};

/** Magic-number sniffing so the declared content type cannot be trusted blindly (NFR-007). */
export function sniffContentType(buf: Buffer, declared: string, fileName: string): string {
  const lower = fileName.toLowerCase();
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf[0] === 0x50 && buf[1] === 0x4b && lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.csv')) {
    // Reject binary content masquerading as CSV
    const sample = buf.subarray(0, 2048);
    if (sample.includes(0)) return 'application/octet-stream-binary';
    return 'text/csv';
  }
  return declared === 'application/octet-stream' ? 'application/octet-stream-unknown' : `unverified:${declared}`;
}

/**
 * Private object storage. Objects are never publicly addressable; all downloads stream through
 * permission-checked API endpoints. Driver: local filesystem (development) or S3-compatible.
 */
@Injectable()
export class StorageService {
  private s3: S3Client | null = null;
  private readonly baseDir: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.baseDir = path.resolve(config.STORAGE_LOCAL_DIR);
    if (config.STORAGE_DRIVER === 's3') {
      this.s3 = new S3Client({
        region: config.S3_REGION,
        endpoint: config.S3_ENDPOINT,
        forcePathStyle: config.S3_FORCE_PATH_STYLE,
        credentials: config.S3_ACCESS_KEY_ID ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? '' } : undefined,
      });
    }
  }

  get maxBytes(): number {
    return this.config.MAX_UPLOAD_MB * 1024 * 1024;
  }

  validateUpload(file: { buffer: Buffer; mimetype: string; originalname: string; size: number } | undefined, kind: keyof typeof ALLOWED_UPLOAD_TYPES): string {
    if (!file) throw badRequest('A file is required');
    if (file.size > this.maxBytes) throw badRequest(`File exceeds the ${this.config.MAX_UPLOAD_MB} MB limit`);
    if (file.size === 0) throw badRequest('File is empty');
    const sniffed = sniffContentType(file.buffer, file.mimetype, file.originalname);
    if (!ALLOWED_UPLOAD_TYPES[kind].includes(sniffed)) throw badRequest(`Unsupported file type for ${kind}. Allowed: ${ALLOWED_UPLOAD_TYPES[kind].join(', ')}`);
    return sniffed;
  }

  /** Builds a tenant-scoped key; tenant prefix is always derived server-side. */
  key(scope: string, ...parts: string[]): string {
    const safe = parts.map((p) => p.replace(/[^A-Za-z0-9._-]/g, '_'));
    return [scope, ...safe.slice(0, -1), `${randomUUID()}-${safe[safe.length - 1]}`].join('/');
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
      return;
    }
    const full = this.resolveLocal(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    if (this.s3) {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
      const bytes = await out.Body!.transformToByteArray();
      return Buffer.from(bytes);
    }
    return fs.readFile(this.resolveLocal(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      if (this.s3) {
        await this.get(key);
        return true;
      }
      await fs.access(this.resolveLocal(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
      return;
    }
    await fs.rm(this.resolveLocal(key), { force: true });
  }

  private resolveLocal(key: string): string {
    const full = path.resolve(this.baseDir, key);
    if (!full.startsWith(this.baseDir + path.sep)) throw badRequest('Invalid storage key');
    return full;
  }
}
