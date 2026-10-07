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
  rootDir = mkdtempSync(path.join(tmpdir(), 'investor-config-'));
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
    // Conditional requirements (CSRF_SECRET, provider keys) are checked once the rest is valid.
    const error = loadError({ CSRF_ENABLED: 'true' });
    expect(error.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/^server\.port /), 'COOKIE_SECRET is required']),
    );
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

describe('ConfigLoader: CSRF flag', () => {
  it('is disabled in the committed config and then needs no CSRF_SECRET', () => {
    const config = new ConfigLoader({ rootDir, env: { COOKIE_SECRET } }).load();
    expect(config.security.csrf.enabled).toBe(false);
    expect(config.secrets.csrfSecret).toBeUndefined();
  });

  it('is enabled by CSRF_ENABLED=true and then requires CSRF_SECRET', () => {
    expect(load({ CSRF_ENABLED: 'true' }).security.csrf.enabled).toBe(true);
    expect(loadError({ COOKIE_SECRET, CSRF_ENABLED: 'true' }).issues).toContain(
      'CSRF_SECRET is required when security.csrf.enabled is true',
    );
  });

  it('rejects a non-boolean CSRF_ENABLED', () => {
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET, CSRF_ENABLED: 'yes' }).message).toContain(
      'security.csrf.enabled (from CSRF_ENABLED) must be true or false',
    );
  });
});

describe('ConfigLoader: logging', () => {
  it('defaults the level to debug in development', () => {
    expect(load({ NODE_ENV: 'development' }).logging.level).toBe('debug');
  });

  it('defaults the level to info in production', () => {
    expect(load({ NODE_ENV: 'production' }).logging.level).toBe('info');
  });

  it('lets LOG_LEVEL win over the default', () => {
    expect(load({ NODE_ENV: 'development', LOG_LEVEL: 'warn' }).logging.level).toBe('warn');
  });

  it('keeps a level set in the config file', () => {
    writeConfig((config) => {
      config.logging = { level: 'error' };
    });
    expect(load({ NODE_ENV: 'development' }).logging.level).toBe('error');
  });

  it('leaves LLM content logging off by default', () => {
    expect(load().logging.llmContent).toBe(false);
  });

  it('turns LLM content logging on with LOG_LLM_CONTENT=true', () => {
    expect(load({ LOG_LLM_CONTENT: 'true' }).logging.llmContent).toBe(true);
  });

  it('rejects a non-boolean LOG_LLM_CONTENT', () => {
    expect(loadError({ COOKIE_SECRET, LOG_LLM_CONTENT: 'yes' }).message).toContain(
      'logging.llmContent (from LOG_LLM_CONTENT) must be true or false',
    );
  });

  it('loads the committed LLM price table', () => {
    expect(load().llm.pricing['claude-opus-5-5']).toEqual({
      inputPerMTok: 4,
      outputPerMTok: 20,
      cacheReadPerMTok: 0.2,
      cacheWritePerMTok: 5,
    });
  });
});

describe('ConfigLoader: TRUST_PROXY', () => {
  it('trusts no proxy in the committed config', () => {
    expect(load().server.trustProxy).toBe(false);
  });

  it('reads a hop count', () => {
    expect(load({ TRUST_PROXY: '1' }).server.trustProxy).toBe(1);
  });

  it('reads a comma list of addresses', () => {
    expect(load({ TRUST_PROXY: '10.0.0.0/8, 172.16.0.0/12' }).server.trustProxy).toEqual([
      '10.0.0.0/8',
      '172.16.0.0/12',
    ]);
  });

  it('reads false over a file value', () => {
    writeConfig((config) => {
      config.server!.trustProxy = 2;
    });
    expect(load({ TRUST_PROXY: 'false' }).server.trustProxy).toBe(false);
  });

  it('rejects true and names the env var', () => {
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET, TRUST_PROXY: 'true' }).message).toContain(
      'server.trustProxy (from TRUST_PROXY)',
    );
  });
});

describe('ConfigLoader: LLM providers', () => {
  const ANTHROPIC_KEY = 'sk-ant-test-key-should-never-be-printed';

  it('loads the committed provider defaults', () => {
    const config = load();
    expect(config.llm.thinking.provider).toBe('ollama');
    expect(config.llm.decision.provider).toBe('laya');
    expect(config.llm.thinking.providers.anthropic.model).toBe('claude-opus-5-5');
    expect(config.dev.playground).toBe(true);
  });

  it('selects providers and endpoints from the environment', () => {
    const config = load({
      THINKING_PROVIDER: 'anthropic',
      DECISION_PROVIDER: 'jev',
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      TYPESAFE_API_KEY: 'ts-key',
      OLLAMA_BASE_URL: 'http://gpu-box:11434',
      LAYA_BASE_URL: 'http://laya.internal:8000',
    });
    expect(config.llm.thinking.provider).toBe('anthropic');
    expect(config.llm.decision.provider).toBe('jev');
    expect(config.secrets.anthropicApiKey).toBe(ANTHROPIC_KEY);
    expect(config.llm.thinking.providers.ollama.baseUrl).toBe('http://gpu-box:11434');
    expect(config.llm.decision.providers.laya.baseUrl).toBe('http://laya.internal:8000');
  });

  it('names an unknown provider and lists the supported ones', () => {
    const error = loadError({ COOKIE_SECRET, CSRF_SECRET, THINKING_PROVIDER: 'gemini' });
    const issue = error.issues.find((i) => i.startsWith('llm.thinking.provider'));
    expect(issue).toContain('(from THINKING_PROVIDER)');
    expect(issue).toMatch(/ollama.*anthropic.*fake/);
  });

  it('attributes a deep override to its env var', () => {
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET, OLLAMA_BASE_URL: 'not a url' }).message).toContain(
      'llm.thinking.providers.ollama.baseUrl (from OLLAMA_BASE_URL)',
    );
  });

  it('requires ANTHROPIC_API_KEY only when anthropic is active', () => {
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET, THINKING_PROVIDER: 'anthropic' }).message).toContain(
      'ANTHROPIC_API_KEY is required',
    );
    expect(load({ THINKING_PROVIDER: 'ollama' }).secrets.anthropicApiKey).toBeUndefined();
  });

  it('requires TYPESAFE_API_KEY for jev but no key for laya', () => {
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET, DECISION_PROVIDER: 'jev' }).message).toContain(
      'TYPESAFE_API_KEY is required',
    );
    expect(load({ DECISION_PROVIDER: 'laya' }).secrets.layaApiKey).toBeUndefined();
  });

  it('rejects fake providers in production', () => {
    const error = loadError({
      COOKIE_SECRET,
      CSRF_SECRET,
      NODE_ENV: 'production',
      THINKING_PROVIDER: 'fake',
      DECISION_PROVIDER: 'fake',
    });
    expect(error.message).toContain('llm.thinking.provider (from THINKING_PROVIDER) must not be "fake"');
    expect(error.message).toContain('llm.decision.provider (from DECISION_PROVIDER) must not be "fake"');
    expect(load({ THINKING_PROVIDER: 'fake', DECISION_PROVIDER: 'fake' }).llm.thinking.provider).toBe('fake');
  });

  it('never prints provider key values', () => {
    const error = loadError({
      COOKIE_SECRET,
      CSRF_SECRET,
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      THINKING_PROVIDER: 'anthropic',
      DECISION_PROVIDER: 'jev',
      PORT: 'abc',
    });
    expect(error.message).not.toContain(ANTHROPIC_KEY);
  });
});

describe('ConfigLoader: game settings', () => {
  it('loads the committed game defaults with every v2 feature off', () => {
    const config = load();
    expect(config.game.currency).toBe('EUR');
    expect(config.game.maxTurns).toBe(15);
    expect(config.game.defaultValuation).toBe(2_000_000);
    expect(config.llm.decision.minConfidence).toBe(0.55);
    const { eventChance, ...flags } = config.game.features;
    expect(eventChance).toBe(0.15);
    expect(Object.values(flags).every((flag) => flag === false)).toBe(true);
  });

  it('names an invalid turn limit', () => {
    writeConfig((config) => {
      config.game!.maxTurns = 0;
    });
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET }).issues.some((i) => i.startsWith('game.maxTurns'))).toBe(
      true,
    );
  });

  it('names an invalid confidence threshold', () => {
    writeConfig((config) => {
      (config.llm!.decision as Record<string, unknown>).minConfidence = 1.5;
    });
    expect(
      loadError({ COOKIE_SECRET, CSRF_SECRET }).issues.some((i) =>
        i.startsWith('llm.decision.minConfidence'),
      ),
    ).toBe(true);
  });

  it('loads the committed negotiation policy', () => {
    expect(load().game.policy).toEqual({
      acceptMinLevel: 3,
      goodDealMin: 0.5,
      walkAwayMinConfidence: 0.7,
      injectionThreshold: 0.6,
      insultThreshold: 0.6,
      concessionSteps: { none: 0, small: 1, medium: 2, large: 3 },
      patienceCost: { reject: 1, insult: 2, injection: 1 },
      interestWeight: 0.2,
    });
  });

  it('names decreasing concession steps', () => {
    writeConfig((config) => {
      (config.game!.policy as Record<string, unknown>).concessionSteps = {
        none: 0,
        small: 2,
        medium: 1,
        large: 3,
      };
    });
    expect(
      loadError({ COOKIE_SECRET, CSRF_SECRET }).issues.some((i) =>
        i.startsWith('game.policy.concessionSteps'),
      ),
    ).toBe(true);
  });

  it('names an invalid policy threshold', () => {
    writeConfig((config) => {
      (config.game!.policy as Record<string, unknown>).injectionThreshold = 1.5;
    });
    expect(
      loadError({ COOKIE_SECRET, CSRF_SECRET }).issues.some((i) =>
        i.startsWith('game.policy.injectionThreshold'),
      ),
    ).toBe(true);
  });

  it('rejects an unsupported currency', () => {
    writeConfig((config) => {
      config.game!.currency = 'USD';
    });
    expect(loadError({ COOKIE_SECRET, CSRF_SECRET }).issues.some((i) => i.startsWith('game.currency'))).toBe(
      true,
    );
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
