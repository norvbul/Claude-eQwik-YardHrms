import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';

/** Wraps successful JSON responses in `{ data }` (consistent structured success responses). */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        if (value instanceof StreamableFile || Buffer.isBuffer(value)) return value;
        if (value && typeof value === 'object' && 'items' in (value as any) && 'total' in (value as any)) {
          const { items, ...meta } = value as any;
          return { data: items, meta };
        }
        return { data: value ?? null };
      }),
    );
  }
}
