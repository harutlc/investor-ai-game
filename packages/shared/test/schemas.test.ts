import { describe, expect, it } from 'vitest';
import { ApiErrorSchema, ErrorCode, HealthDtoSchema, SessionDtoSchema } from '../src/index.js';

describe('ApiErrorSchema', () => {
  it('accepts a valid envelope', () => {
    const parsed = ApiErrorSchema.parse({
      error: { code: 'NOT_FOUND', message: 'Route not found', requestId: 'abc' },
    });
    expect(parsed.error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('accepts optional details', () => {
    expect(
      ApiErrorSchema.safeParse({
        error: { code: 'VALIDATION_ERROR', message: 'bad', details: [{ path: 'x' }], requestId: 'r' },
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown code', () => {
    expect(
      ApiErrorSchema.safeParse({ error: { code: 'TEAPOT', message: 'x', requestId: 'r' } }).success,
    ).toBe(false);
  });

  it('rejects a missing requestId', () => {
    expect(ApiErrorSchema.safeParse({ error: { code: 'NOT_FOUND', message: 'x' } }).success).toBe(false);
  });

  it('rejects extra fields such as a stack trace', () => {
    expect(
      ApiErrorSchema.safeParse({
        error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r', stack: 'at foo()' },
      }).success,
    ).toBe(false);
  });
});

describe('DTO schemas', () => {
  it('validates a session', () => {
    expect(
      SessionDtoSchema.safeParse({
        playerId: '3f1c2b4e-8a5d-4c6e-9f7a-1b2c3d4e5f60',
        createdAt: '2026-10-03T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects a session with a non-uuid playerId', () => {
    expect(SessionDtoSchema.safeParse({ playerId: '1', createdAt: '2026-10-03T10:00:00.000Z' }).success).toBe(
      false,
    );
  });

  it('validates health', () => {
    expect(
      HealthDtoSchema.safeParse({
        status: 'ok',
        uptime: 1.5,
        checks: { database: 'ok', thinking: 'ok', decision: 'ok' },
      }).success,
    ).toBe(true);
  });
});
