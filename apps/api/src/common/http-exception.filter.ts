import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ErrorCodes } from '@yardhrms/types';
import { RequestContext } from './request-context';
import { PrismaService } from '../prisma/prisma.service';

/** Converts every error into the structured `{ error: { code, message, details, requestId } }` envelope. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');
  constructor(private readonly prisma?: PrismaService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest();
    const requestId = RequestContext.get()?.requestId;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCodes.INTERNAL;
    let message = 'An unexpected error occurred. Please try again or contact support with the request ID.';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      if (body && typeof body === 'object' && body.code) {
        code = body.code;
        message = body.message;
        details = body.details;
      } else {
        message = typeof body === 'string' ? body : body?.message ?? exception.message;
        if (Array.isArray(message)) message = message.join('; ');
        code =
          status === 404
            ? ErrorCodes.NOT_FOUND
            : status === 401
              ? ErrorCodes.UNAUTHENTICATED
              : status === 403
                ? ErrorCodes.FORBIDDEN
                : status === 413
                  ? ErrorCodes.VALIDATION_FAILED
                  : status === 400
                    ? ErrorCodes.VALIDATION_FAILED
                    : ErrorCodes.INTERNAL;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = ErrorCodes.CONFLICT;
        message = 'A record with the same unique value already exists';
        details = { fields: (exception.meta as any)?.target };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = ErrorCodes.NOT_FOUND;
        message = 'Record not found';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        code = ErrorCodes.VALIDATION_FAILED;
        message = 'A referenced record does not exist or belongs to another organization';
      } else if (/PAYROLL_LOCKED/.test(exception.message)) {
        status = HttpStatus.CONFLICT;
        code = ErrorCodes.PAYROLL_LOCKED;
        message = 'Approved payroll data is immutable';
      }
    } else if (exception instanceof Error && /PAYROLL_LOCKED|append-only/.test(exception.message)) {
      status = HttpStatus.CONFLICT;
      code = ErrorCodes.PAYROLL_LOCKED;
      message = 'This record is immutable (approved payroll or append-only history)';
    } else if (exception instanceof Error && (exception as any).type === 'entity.too.large') {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      code = ErrorCodes.VALIDATION_FAILED;
      message = 'Request is too large';
    }

    if (status >= 500) {
      const err = exception as Error;
      this.logger.error(`[${requestId}] ${req?.method} ${req?.url}: ${err?.message}`, err?.stack);
      this.prisma?.systemError
        .create({ data: { requestId, path: String(req?.url ?? '').slice(0, 255), message: String(err?.message ?? exception).slice(0, 5000), stack: err?.stack?.slice(0, 10000) } })
        .catch(() => undefined);
    }

    res.status(status).json({ error: { code, message, details, requestId } });
  }
}
