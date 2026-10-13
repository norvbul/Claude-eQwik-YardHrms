import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContext } from '../common/request-context';
import { PrismaService, Tx } from '../prisma/prisma.service';

const SENSITIVE_KEY = /password|secret|token|hash|enc$|accountnumber|^trn$|^nis|^nht|code$|^code/i;
const ALLOWED_DESPITE_PATTERN = new Set(['employeeNumber', 'planCode', 'productCode', 'codeHint', 'code', 'leaveTypeCode', 'statusCode']);

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 5) return '[depth]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k) && !ALLOWED_DESPITE_PATTERN.has(k)) out[k] = v == null ? null : '[REDACTED]';
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  tenantId?: string | null;
  scope?: 'TENANT' | 'PLATFORM' | 'SYSTEM';
  action: string;
  entityType: string;
  entityId?: string | null;
  subjectEmployeeId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  reason?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
}

/** Immutable audit trail (NFR-005). Rows are append-only; a DB trigger rejects UPDATE/DELETE. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, tx?: Tx): Promise<void> {
    const ctx = RequestContext.get();
    const client = tx ?? this.prisma;
    await client.auditEvent.create({
      data: {
        tenantId: input.tenantId ?? null,
        scope: input.scope ?? (input.tenantId ? 'TENANT' : 'PLATFORM'),
        actorUserId: input.actorUserId ?? ctx?.userId ?? null,
        actorEmail: input.actorEmail ?? ctx?.userEmail ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        subjectEmployeeId: input.subjectEmployeeId ?? null,
        before: input.before === undefined ? undefined : (redact(input.before) as Prisma.InputJsonValue),
        after: input.after === undefined ? undefined : (redact(input.after) as Prisma.InputJsonValue),
        metadata: input.metadata === undefined ? undefined : (redact(input.metadata) as Prisma.InputJsonValue),
        reason: input.reason?.slice(0, 500) ?? null,
        requestId: ctx?.requestId ?? null,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
      },
    });
  }
}
