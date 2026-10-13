import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCodes, type ErrorCode } from '@yardhrms/types';

export class AppError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: number,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(ErrorCodes.VALIDATION_FAILED, message, HttpStatus.BAD_REQUEST, details);
export const businessRule = (message: string, details?: unknown) => new AppError(ErrorCodes.BUSINESS_RULE, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
export const invalidState = (message: string, details?: unknown) => new AppError(ErrorCodes.INVALID_STATE, message, HttpStatus.CONFLICT, details);
export const conflict = (message: string, details?: unknown) => new AppError(ErrorCodes.CONFLICT, message, HttpStatus.CONFLICT, details);
export const notFound = (what = 'Record') => new AppError(ErrorCodes.NOT_FOUND, `${what} not found`, HttpStatus.NOT_FOUND);
export const forbidden = (message = 'You do not have permission to perform this action', details?: unknown) =>
  new AppError(ErrorCodes.FORBIDDEN, message, HttpStatus.FORBIDDEN, details);
export const unauthenticated = (message = 'Please sign in to continue') => new AppError(ErrorCodes.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
export const capacityExceeded = (message: string, details?: unknown) => new AppError(ErrorCodes.CAPACITY_EXCEEDED, message, HttpStatus.PAYMENT_REQUIRED, details);
export const payrollLocked = (message = 'This payroll run is approved/locked and cannot be edited. Use a reversal or supplemental run.') =>
  new AppError(ErrorCodes.PAYROLL_LOCKED, message, HttpStatus.CONFLICT);
