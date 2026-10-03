import { z } from 'zod';

const MIN_SECRET_LENGTH = 32;

const required = (what: string) => ({
  error: (issue: { input: unknown }) => (issue.input === undefined ? 'is required' : `must be ${what}`),
});

const secret = z.string(required('a string')).min(MIN_SECRET_LENGTH, {
  error: `must be at least ${MIN_SECRET_LENGTH} characters`,
});

const origin = z.string(required('a string')).refine(
  (value) => {
    if (value === '*') return false;
    try {
      return new URL(value).origin === value;
    } catch {
      return false;
    }
  },
  { error: 'must be an exact origin like "https://app.example.com" (no wildcard, path or trailing slash)' },
);

const port = z.coerce.number(required('a number')).int().min(1).max(65535);

/** Schema for the merged configuration (config file + environment). */
export const AppConfigSchema = z
  .object({
    nodeEnv: z.enum(['development', 'production', 'test']),
    server: z
      .object({
        port,
        /** `false`, a hop count, or a list of trusted proxy addresses/CIDRs. Never `true`. */
        trustProxy: z.union([z.literal(false), z.number().int().min(1), z.array(z.string().min(1)).min(1)]),
        bodyLimit: z.string().regex(/^\d+(b|kb|mb)$/i, { error: 'must look like "100kb"' }),
        shutdownTimeoutMs: z.number().int().positive(),
      })
      .strict(),
    cors: z
      .object({
        origins: z.array(origin).min(1),
      })
      .strict(),
    security: z
      .object({
        rateLimit: z
          .object({
            windowMs: z.number().int().positive(),
            max: z.number().int().positive(),
            mutationMax: z.number().int().positive(),
          })
          .strict(),
        sessionMaxAgeDays: z.number().int().positive(),
      })
      .strict(),
    database: z
      .object({
        file: z.string(required('a string')).min(1),
      })
      .strict(),
    logging: z
      .object({
        level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
      })
      .strict(),
    secrets: z
      .object({
        cookieSecret: secret,
        csrfSecret: secret,
      })
      .strict(),
  })
  .strict()
  .refine((config) => config.secrets.cookieSecret !== config.secrets.csrfSecret, {
    error: 'must differ from COOKIE_SECRET',
    path: ['secrets', 'csrfSecret'],
  });

export type AppConfigInput = z.input<typeof AppConfigSchema>;
export type ParsedAppConfig = z.output<typeof AppConfigSchema>;
