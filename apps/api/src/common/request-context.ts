import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContextData {
  requestId: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  userEmail?: string;
  tenantId?: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  get(): RequestContextData | undefined {
    return storage.getStore();
  },
  set(patch: Partial<RequestContextData>) {
    const s = storage.getStore();
    if (s) Object.assign(s, patch);
  },
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
};

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', requestId);
  storage.run({ requestId, ip: req.ip, userAgent: req.header('user-agent')?.slice(0, 255) }, () => next());
}
