import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LoggerFactory } from '../../src/logging/LoggerFactory.js';
import { RequestContext } from '../../src/logging/RequestContext.js';
import { testConfig } from '../support/testConfig.js';

function capture(level: 'info' | 'debug' = 'info') {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const logger = LoggerFactory.create(testConfig({ logLevel: level }), sink);
  const entries = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, entries };
}

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

  it('redacts the x-api-key header', () => {
    const { logger, entries } = capture();
    logger.info({ req: { headers: { 'x-api-key': 'sk-ant-1' } } }, 'outbound');
    expect((entries()[0]!.req as { headers: Record<string, string> }).headers['x-api-key']).toBe(
      '[Redacted]',
    );
  });

  it('redacts secret fields at the top level', () => {
    const { logger, lines, entries } = capture();
    logger.info({ password: 'hunter2', token: 't-1', apiKey: 'k-1', api_key: 'k-2', user: 'ana' }, 'login');
    const entry = entries()[0]!;
    expect(entry).toMatchObject({
      password: '[Redacted]',
      token: '[Redacted]',
      apiKey: '[Redacted]',
      api_key: '[Redacted]',
      user: 'ana',
    });
    expect(lines[0]).not.toMatch(/hunter2|t-1|k-1|k-2/);
  });

  it('redacts secret fields one level down and keeps the rest of the object', () => {
    const { logger, entries } = capture();
    logger.info({ provider: { apiKey: 'sk-ant-secret', name: 'anthropic' } }, 'configured');
    expect(entries()[0]!.provider).toEqual({ apiKey: '[Redacted]', name: 'anthropic' });
  });

  it('adds the request id inside a request context and not outside it', () => {
    const { logger, entries } = capture();
    logger.info('startup');
    RequestContext.run({ requestId: 'req-1' }, () => logger.child({ module: 'brain' }).info('inside'));
    const [outside, inside] = entries();
    expect(outside).not.toHaveProperty('requestId');
    expect(inside).toMatchObject({ requestId: 'req-1', module: 'brain' });
  });

  it('lets a field the line sets itself win over the context', () => {
    const { logger, lines } = capture();
    RequestContext.run({ requestId: 'req-1' }, () => logger.info({ requestId: 'explicit' }, 'x'));
    expect(lines[0]!.match(/"requestId"/g)).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ requestId: 'explicit' });
    expect(RequestContext.get()).toBeUndefined();
  });

  it('honours the configured level', () => {
    const { logger, entries } = capture('info');
    logger.debug('hidden');
    logger.info('shown');
    expect(entries().map((e) => e.msg)).toEqual(['shown']);
  });
});
