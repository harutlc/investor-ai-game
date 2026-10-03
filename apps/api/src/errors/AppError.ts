import type { ErrorCode } from '@inverstorm/shared';

/** Base class for expected errors; the error handler maps it to the API error envelope. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
