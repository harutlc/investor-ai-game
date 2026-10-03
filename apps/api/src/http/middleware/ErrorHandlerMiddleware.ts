import { ErrorCode, type ApiError } from '@investor/shared';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { AppError } from '../../errors/AppError.js';
import { InvalidJsonError } from '../../errors/InvalidJsonError.js';
import { PayloadTooLargeError } from '../../errors/PayloadTooLargeError.js';
import { UnsupportedMediaTypeError } from '../../errors/UnsupportedMediaTypeError.js';

/** Errors raised by the JSON body parser carry a `type`. */
interface BodyParserError {
  type: string;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return typeof error === 'object' && error !== null && typeof (error as BodyParserError).type === 'string';
}

/** Maps every error to the `{ error: { code, message, details?, requestId } }` envelope. */
export class ErrorHandlerMiddleware {
  constructor(
    private readonly logger: Logger,
    private readonly isProduction: boolean,
  ) {}

  readonly handle = (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const appError = this.toAppError(error);
    // pino-http attaches a request-scoped logger (with the request id); fall back when it is not mounted.
    const log = (req as { log?: Logger }).log ?? this.logger;
    if (appError) {
      log.warn(
        { err: { name: appError.name, code: appError.code, message: appError.message } },
        'request failed',
      );
    } else {
      log.error({ err: error }, 'unhandled error');
    }

    const status = appError?.status ?? 500;
    const body: ApiError = {
      error: {
        code: appError?.code ?? ErrorCode.INTERNAL_ERROR,
        message: appError?.message ?? this.unexpectedMessage(error),
        ...(appError?.details === undefined ? {} : { details: appError.details }),
        requestId: req.requestId,
      },
    };
    res.status(status).json(body);
  };

  private toAppError(error: unknown): AppError | undefined {
    if (error instanceof AppError) return error;
    if (isBodyParserError(error)) {
      switch (error.type) {
        case 'entity.parse.failed':
          return new InvalidJsonError();
        case 'entity.too.large':
          return new PayloadTooLargeError();
        case 'encoding.unsupported':
        case 'charset.unsupported':
          return new UnsupportedMediaTypeError('Unsupported body encoding or charset');
      }
    }
    return undefined;
  }

  /** Never leak internal messages in production. */
  private unexpectedMessage(error: unknown): string {
    if (!this.isProduction && error instanceof Error) return error.message;
    return 'Internal server error';
  }
}
