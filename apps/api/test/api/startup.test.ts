import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = path.resolve(import.meta.dirname, '../..');
const TSX = path.join(API_ROOT, 'node_modules/.bin/tsx');

/** Runs the real entry point with `env` and collects its exit code and output. */
function runApi(env: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, ['--conditions=development', 'src/main.ts'], {
      cwd: API_ROOT,
      env: { PATH: process.env.PATH, ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the API did not exit:\n${output}`));
    }, 20_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

const portIsOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

describe('API startup', () => {
  it.each(['postgres', 'mysql'] as const)(
    'exits non-zero without listening when the %s server is unreachable, never logging the password',
    async (dialect) => {
      const port = 39_000 + Math.floor(Math.random() * 1000);
      const { code, output } = await runApi({
        NODE_ENV: 'test',
        PORT: String(port),
        COOKIE_SECRET: 'c'.repeat(40),
        THINKING_PROVIDER: 'fake',
        DECISION_PROVIDER: 'fake',
        DATABASE_DIALECT: dialect,
        DATABASE_URL: `${dialect}://game:s3cret@127.0.0.1:1/game`,
      });
      expect(code).not.toBe(0);
      expect(output).toContain(`could not open the ${dialect} database at 127.0.0.1:1`);
      expect(output).not.toContain('s3cret');
      expect(output).not.toContain('API listening');
      expect(await portIsOpen(port)).toBe(false);
    },
    30_000,
  );
});
