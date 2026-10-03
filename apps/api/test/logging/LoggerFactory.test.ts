import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LoggerFactory } from '../../src/logging/LoggerFactory.js';
import { testConfig } from '../support/testConfig.js';

describe('LoggerFactory', () => {
  it('redacts cookies, authorization, CSRF tokens and set-cookie', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = LoggerFactory.create(testConfig({ logLevel: 'info' }), sink);

    logger.info(
      {
        req: {
          headers: {
            cookie: 'inv.pid=s:secret',
            authorization: 'Bearer t',
            'x-csrf-token': 'tok',
            accept: '*/*',
          },
        },
        res: { headers: { 'set-cookie': 'inv.pid=s:secret' } },
      },
      'request completed',
    );

    const entry = JSON.parse(lines[0]!) as {
      req: { headers: Record<string, string> };
      res: { headers: Record<string, string> };
    };
    expect(entry.req.headers.cookie).toBe('[Redacted]');
    expect(entry.req.headers.authorization).toBe('[Redacted]');
    expect(entry.req.headers['x-csrf-token']).toBe('[Redacted]');
    expect(entry.res.headers['set-cookie']).toBe('[Redacted]');
    expect(entry.req.headers.accept).toBe('*/*');
    expect(lines[0]).not.toContain('secret');
  });
});
