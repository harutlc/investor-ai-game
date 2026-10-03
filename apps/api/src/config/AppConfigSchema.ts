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

const httpUrl = z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' });
const model = z.string(required('a string')).min(1);
const transport = {
  timeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0).max(5),
};

export const THINKING_PROVIDERS = ['ollama', 'anthropic', 'fake'] as const;
export const DECISION_PROVIDERS = ['jev', 'laya', 'fake'] as const;

const ThinkingConfigSchema = z
  .object({
    provider: z.enum(THINKING_PROVIDERS),
    providers: z
      .object({
        ollama: z
          .object({
            baseUrl: httpUrl,
            model,
            temperature: z.number().min(0).max(2),
            maxTokens: z.number().int().positive(),
            ...transport,
          })
          .strict(),
        anthropic: z
          .object({
            model,
            maxTokens: z.number().int().positive(),
            effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
            /** Server-side refusal fallback (`fallbacks: "default"`). */
            fallbacks: z.boolean(),
            ...transport,
          })
          .strict(),
        fake: z.object({}).strict(),
      })
      .strict(),
  })
  .strict();

const systemOneProvider = z.object({ baseUrl: httpUrl, model, ...transport }).strict();

const DecisionConfigSchema = z
  .object({
    provider: z.enum(DECISION_PROVIDERS),
    providers: z
      .object({
        jev: systemOneProvider,
        laya: systemOneProvider,
        fake: z.object({}).strict(),
      })
      .strict(),
  })
  .strict();

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
    llm: z
      .object({
        thinking: ThinkingConfigSchema,
        decision: DecisionConfigSchema,
        /** How long provider reachability results are cached for /api/health. */
        healthCacheMs: z.number().int().min(0),
      })
      .strict(),
    dev: z
      .object({
        /** Mounts /api/dev/* outside production. */
        playground: z.boolean(),
      })
      .strict(),
    secrets: z
      .object({
        cookieSecret: secret,
        csrfSecret: secret,
        anthropicApiKey: z.string().min(1).optional(),
        typesafeApiKey: z.string().min(1).optional(),
        layaApiKey: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const { secrets, llm, nodeEnv } = config;
    if (secrets.cookieSecret === secrets.csrfSecret) {
      ctx.addIssue({
        code: 'custom',
        message: 'must differ from COOKIE_SECRET',
        path: ['secrets', 'csrfSecret'],
      });
    }
    // Only the active provider's key is required.
    if (llm.thinking.provider === 'anthropic' && !secrets.anthropicApiKey) {
      ctx.addIssue({
        code: 'custom',
        message: 'is required when the thinking provider is "anthropic"',
        path: ['secrets', 'anthropicApiKey'],
      });
    }
    if (llm.decision.provider === 'jev' && !secrets.typesafeApiKey) {
      ctx.addIssue({
        code: 'custom',
        message: 'is required when the decision provider is "jev"',
        path: ['secrets', 'typesafeApiKey'],
      });
    }
    if (nodeEnv === 'production') {
      for (const kind of ['thinking', 'decision'] as const) {
        if (llm[kind].provider === 'fake') {
          ctx.addIssue({
            code: 'custom',
            message: 'must not be "fake" in production',
            path: ['llm', kind, 'provider'],
          });
        }
      }
    }
  });

export type AppConfigInput = z.input<typeof AppConfigSchema>;
export type ParsedAppConfig = z.output<typeof AppConfigSchema>;
