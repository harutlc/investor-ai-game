import { deepFreeze, type AppConfig } from '../../src/config/AppConfig.js';
import type { ParsedAppConfig } from '../../src/config/AppConfigSchema.js';

type MutableConfig = ParsedAppConfig & { isProduction: boolean; rootDir: string };

type Overrides = {
  nodeEnv?: AppConfig['nodeEnv'];
  /** Arbitrary edits (e.g. the `llm` section) applied before freezing. */
  mutate?: (config: MutableConfig) => void;
  playground?: boolean;
  /** CSRF protection; on by default in tests so the security behavior stays covered. */
  csrf?: boolean;
  server?: Partial<MutableConfig['server']>;
  cors?: Partial<MutableConfig['cors']>;
  rateLimit?: Partial<MutableConfig['security']['rateLimit']>;
  sessionMaxAgeDays?: number;
  logLevel?: AppConfig['logging']['level'];
};

export const TEST_COOKIE_SECRET = 'test-cookie-secret-0123456789abcdef0123';
export const TEST_CSRF_SECRET = 'test-csrf-secret-0123456789abcdef01234567';
export const ALLOWED_ORIGIN = 'http://localhost:5173';

/** A valid, in-memory configuration for tests. */
export function testConfig(overrides: Overrides = {}): AppConfig {
  const nodeEnv = overrides.nodeEnv ?? 'test';
  const config: MutableConfig = {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    rootDir: process.cwd(),
    server: { port: 0, trustProxy: false, bodyLimit: '100kb', shutdownTimeoutMs: 1000, ...overrides.server },
    cors: { origins: [ALLOWED_ORIGIN], ...overrides.cors },
    security: {
      rateLimit: { windowMs: 60_000, max: 1000, mutationMax: 1000, ...overrides.rateLimit },
      sessionMaxAgeDays: overrides.sessionMaxAgeDays ?? 30,
      csrf: { enabled: overrides.csrf ?? true },
    },
    database: { file: ':memory:' },
    logging: { level: overrides.logLevel ?? 'silent' },
    llm: {
      thinking: {
        provider: 'fake',
        providers: {
          ollama: {
            baseUrl: 'http://ollama.test:11434',
            model: 'llama3.1:8b',
            temperature: 0.8,
            maxTokens: 512,
            timeoutMs: 1000,
            maxRetries: 1,
          },
          anthropic: {
            model: 'claude-opus-5-5',
            maxTokens: 1024,
            effort: 'low',
            fallbacks: true,
            timeoutMs: 1000,
            maxRetries: 0,
          },
          fake: {},
        },
      },
      decision: {
        provider: 'fake',
        providers: {
          laya: { baseUrl: 'http://laya.test:8000', model: 'english', timeoutMs: 1000, maxRetries: 0 },
          jev: { baseUrl: 'https://jev.test', model: 'jev-latest', timeoutMs: 1000, maxRetries: 0 },
          fake: {},
        },
      },
      healthCacheMs: 30_000,
    },
    dev: { playground: overrides.playground ?? true },
    secrets: { cookieSecret: TEST_COOKIE_SECRET, csrfSecret: TEST_CSRF_SECRET },
  };
  overrides.mutate?.(config);
  return deepFreeze(config);
}
