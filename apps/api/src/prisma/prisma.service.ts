import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'] });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Serializable-enough transaction wrapper with sane timeouts for business operations. */
  tx<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
    return this.$transaction(fn, { timeout: opts?.timeout ?? 20_000, maxWait: 10_000, isolationLevel: opts?.isolationLevel });
  }

  /** Locks the tenant row (SELECT … FOR UPDATE) to serialize capacity-sensitive writes. */
  async lockTenant(tx: Tx, tenantId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
  }
}
