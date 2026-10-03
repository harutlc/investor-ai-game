import { Writable } from 'node:stream';
import { pino, type Logger } from 'pino';

/** A logger that captures JSON lines, for asserting on what providers log (and never log). */
export function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { logger: pino({ level: 'debug' }, sink), lines };
}
