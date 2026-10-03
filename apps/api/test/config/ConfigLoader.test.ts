import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/config/ConfigError.js';
import { ConfigLoader } from '../../src/config/ConfigLoader.js';
import { WorkspaceRoot } from '../../src/config/WorkspaceRoot.js';

const COOKIE_SECRET = 'c'.repeat(40);
const CSRF_SECRET = 'x'.repeat(40);
const repoRoot = WorkspaceRoot.find(import.meta.dirname);
const committedConfig = readFileSync(path.join(repoRoot, 'config/app.config.json'), 'utf8');

let rootDir: string;

function writeConfig(mutate?: (config: Record<string, Record<string, unknown>>) => void): void {
  const config = JSON.parse(committedConfig) as Record<string, Record<string, unknown>>;
  mutate?.(config);
  writeFileSync(path.join(rootDir, 'config/app.config.json'), JSON.stringify(config));
}

function load(env: NodeJS.ProcessEnv = {}) {
  return new ConfigLoader({ rootDir, env: { COOKIE_SECRET, CSRF_SECRET, ...env } }).load();
}

function loadError(env: NodeJS.ProcessEnv = {}): ConfigError {
  try {
    new ConfigLoader({ rootDir, env }).load();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected ConfigError');
}

beforeEach(() => {
  rootDir = mkdtempSync(path.join(tmpdir(), 'inverstorm-config-'));
  mkdirSync(path.join(rootDir, 'config'));
  writeConfig();
});

describe('ConfigLoader', () => {
  it('loads the committed config with secrets from the environment', () => {
    const config = load();
    expect(config.server.port).toBe(3001);
    expect(config.cors.origins).toEqual(['http://localhost:5173']);
    expect(config.secrets.cookieSecret).toBe(COOKIE_SECRET);
    expect(config.nodeEnv).toBe('development');
    expect(config.isProduction).toBe(false);
    expect(config.database.file).toBe(path.join(rootDir, 'data/game.sqlite'));
  });

  it('lets environment variables override the file', () => {
    const config = load({
      PORT: '4000',
      CORS_ORIGINS: 'https://a.example, https://b.example',
      DATABASE_FILE: ':memory:',
      LOG_LEVEL: 'debug',
      NODE_ENV: 'production',
    });
    expect(config.server.port).toBe(4000);
    expect(config.cors.origins).toEqual(['https://a.example', 'https://b.example']);
    expect(config.database.file).toBe(':memory:');
    expect(config.logging.level).toBe('debug');
    expect(config.isProduction).toBe(true);
  });

  it('treats empty environment values as unset', () => {
    expect(load({ PORT: '', CORS_ORIGINS: '' }).server.port).toBe(3001);
  });

  it('reads .env from the root but lets the real environment win', () => {
    writeFileSync(path.join(rootDir, '.env'), `COOKIE_SECRET=${'d'.repeat(40)}\nPORT=5000\n`);
    const config = new ConfigLoader({ rootDir, env: { CSRF_SECRET, PORT: '6000' } }).load();
    expect(config.secrets.cookieSecret).toBe('d'.repeat(40));
    expect(config.server.port).toBe(6000);
  });

  it('names a missing secret by its environment variable', () => {
    const error = loadError({ CSRF_SECRET });
    expect(error.issues).toContain('COOKIE_SECRET is required');
  });

  it('rejects a short secret without printing its value', () => {
    const error = loadError({ COOKIE_SECRET, CSRF_SECRET: 'tooshort-secret-value' });
    expect(error.message).toContain('CSRF_SECRET must be at least 32 characters');
    expect(error.message).not.toContain('tooshort-secret-value');
  });

  it('rejects identical secrets', () => {
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET: COOKIE_SECRET }).message).toContain(
      'CSRF_SECRET must differ from COOKIE_SECRET',
    );
  });

  it('names an invalid file value by its path', () => {
    writeConfig((config) => {
      config.server!.port = 'abc';
    });
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET }).issues.some((i) => i.startsWith('server.port'))).toBe(
      true,
    );
  });

  it('marks invalid values that came from an env override', () => {
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET, PORT: 'abc' }).message).toContain(
      'server.port (from PORT)',
    );
  });

  it('reports every problem at once', () => {
    writeConfig((config) => {
      config.server!.port = 'abc';
    });
    const error = loadError({});
    expect(error.issues.length).toBeGreaterThanOrEqual(3);
  });

  it.each(['*', 'http://localhost:5173/', 'not a url'])('rejects CORS origin %s', (origin) => {
    writeConfig((config) => {
      config.cors!.origins = [origin];
    });
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET }).message).toContain('cors.origins.0');
  });

  it('rejects trustProxy: true', () => {
    writeConfig((config) => {
      config.server!.trustProxy = true;
    });
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET }).message).toContain('server.trustProxy');
  });

  it('fails clearly when the config file is missing', () => {
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET, APP_CONFIG_PATH: 'nope.json' }).message).toContain(
      'config file not found',
    );
  });

  it('returns a deeply frozen object', () => {
    const config = load();
    expect(() => {
      (config.server as { port: number }).port = 1;
    }).toThrow(TypeError);
    expect(() => {
      (config.cors.origins as string[]).push('https://x.example');
    }).toThrow(TypeError);
    expect(config.server.port).toBe(3001);
  });
});

describe('WorkspaceRoot', () => {
  it('finds the repo root from apps/api', () => {
    expect(WorkspaceRoot.find(path.join(repoRoot, 'apps/api'))).toBe(repoRoot);
  });

  it('throws when no workspace marker exists', () => {
    expect(() => WorkspaceRoot.find(tmpdir())).toThrow(/pnpm-workspace\.yaml/);
  });
});
