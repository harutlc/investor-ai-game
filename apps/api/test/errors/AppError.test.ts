import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/AppError.js';
import { CsrfError } from '../../src/errors/CsrfError.js';
import { InvalidJsonError } from '../../src/errors/InvalidJsonError.js';
import { NotFoundError } from '../../src/errors/NotFoundError.js';
import { PayloadTooLargeError } from '../../src/errors/PayloadTooLargeError.js';
import { RateLimitError } from '../../src/errors/RateLimitError.js';
import { UnsupportedMediaTypeError } from '../../src/errors/UnsupportedMediaTypeError.js';
import { ValidationError } from '../../src/errors/ValidationError.js';

describe('AppError subclasses', () => {
  it.each([
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ValidationError([]), 400, 'VALIDATION_ERROR'],
    [new InvalidJsonError(), 400, 'INVALID_JSON'],
    [new CsrfError(), 403, 'CSRF_INVALID'],
    [new UnsupportedMediaTypeError(), 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [new PayloadTooLargeError(), 413, 'PAYLOAD_TOO_LARGE'],
    [new RateLimitError(), 429, 'RATE_LIMITED'],
  ] as const)('%o maps to %i %s', (error, status, code) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.name).toBe(error.constructor.name);
  });

  it('carries validation issues as details', () => {
    expect(new ValidationError([{ path: 'body.x', message: 'Required' }]).details).toEqual([
      { path: 'body.x', message: 'Required' },
    ]);
  });
});
