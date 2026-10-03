import { deepFreeze, type AppConfig } from '../../src/config/AppConfig.js';

type Overrides = {
  nodeEnv?: AppConfig['nodeEnv'];
  server?: Partial<AppConfig['server']>;
  cors?: Partial<AppConfig['cors']>;
  rateLimit?: Partial<AppConfig['security']['rateLimit']>;
  sessionMaxAgeDays?: number;
  logLevel?: AppConfig['logging']['level'];
};

export const TEST_COOKIE_SECRET = 'test-cookie-secret-0123456789abcdef0123';
export const TEST_CSRF_SECRET = 'test-csrf-secret-0123456789abcdef01234567';
export const ALLOWED_ORIGIN = 'http://localhost:5173';

/** A valid, in-memory configuration for tests. */
export function testConfig(overrides: Overrides = {}): AppConfig {
  const nodeEnv = overrides.nodeEnv ?? 'test';
  return deepFreeze({
    nodeEnv,
    isProduction: nodeEnv === 'production',
    rootDir: process.cwd(),
    server: { port: 0, trustProxy: false, bodyLimit: '100kb', shutdownTimeoutMs: 1000, ...overrides.server },
    cors: { origins: [ALLOWED_ORIGIN], ...overrides.cors },
    security: {
      rateLimit: { windowMs: 60_000, max: 1000, mutationMax: 1000, ...overrides.rateLimit },
      sessionMaxAgeDays: overrides.sessionMaxAgeDays ?? 30,
    },
    database: { file: ':memory:' },
    logging: { level: overrides.logLevel ?? 'silent' },
    secrets: { cookieSecret: TEST_COOKIE_SECRET, csrfSecret: TEST_CSRF_SECRET },
  });
}
