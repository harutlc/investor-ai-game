import { MoneySchema } from '@investor/shared';
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

/** USD per million tokens, per token category. */
const ModelPriceSchema = z
  .object({
    inputPerMTok: z.number().nonnegative(),
    outputPerMTok: z.number().nonnegative(),
    cacheReadPerMTok: z.number().nonnegative(),
    cacheWritePerMTok: z.number().nonnegative(),
  })
  .strict();

const systemOneProvider = z.object({ baseUrl: httpUrl, model, ...transport }).strict();

const DecisionConfigSchema = z
  .object({
    provider: z.enum(DECISION_PROVIDERS),
    /** Answers below this confidence count as uncertain (noul: the likelier outcome's probability). */
    minConfidence: z.number().min(0).max(1),
    providers: z
      .object({
        jev: systemOneProvider,
        laya: systemOneProvider,
        fake: z.object({}).strict(),
      })
      .strict(),
  })
  .strict();

/** Probability-like setting (a threshold or weight between 0 and 1). */
const Unit = z.number().min(0).max(1);

/** The negotiation policy's thresholds and weights; see the negotiation-policy spec. */
const PolicyConfigSchema = z
  .object({
    /** Minimum `accept` score (0 = definitely reject … 4 = definitely accept) for the investor to accept. */
    acceptMinLevel: z.number().min(0).max(4),
    /** Minimum `good_deal` probability for the investor to accept. */
    goodDealMin: Unit,
    /** Minimum confidence for a `walk_away` reaction to end the game; below it the investor rejects. */
    walkAwayMinConfidence: Unit,
    /** Stage A injection probability at which the investor brushes the move off. */
    injectionThreshold: Unit,
    /** `insult` probability at which the player's rudeness costs patience. */
    insultThreshold: Unit,
    /** Concession steps per `concession_size`, multiplied by the persona's concession step. */
    concessionSteps: z
      .object({
        none: z.number().nonnegative(),
        small: z.number().nonnegative(),
        medium: z.number().nonnegative(),
        large: z.number().nonnegative(),
      })
      .strict()
      .refine((s) => s.none <= s.small && s.small <= s.medium && s.medium <= s.large, {
        error: 'must not decrease from none to large',
      }),
    /** Patience lost per event. */
    patienceCost: z
      .object({
        reject: z.number().int().nonnegative(),
        insult: z.number().int().nonnegative(),
        injection: z.number().int().nonnegative(),
      })
      .strict(),
    /** How strongly `good_deal` moves interest each turn. */
    interestWeight: Unit,
  })
  .strict();

const GameConfigSchema = z
  .object({
    currency: z.literal('EUR'),
    maxTurns: z.number().int().min(1).max(50),
    /** Pre-money valuation suggested for a new pitch. */
    defaultValuation: MoneySchema,
    /** v2 features; each stays off until its feature exists. */
    features: z
      .object({
        phases: z.boolean(),
        dueDiligence: z.boolean(),
        dealTerms: z.boolean(),
        hiddenFacts: z.boolean(),
        marketEvents: z.boolean(),
        /** Chance of a market event between turns, when marketEvents is on. */
        eventChance: z.number().min(0).max(1),
        debrief: z.boolean(),
      })
      .strict(),
    policy: PolicyConfigSchema,
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
        csrf: z
          .object({
            /** Double-submit CSRF tokens on state-changing requests (needs CSRF_SECRET when on). */
            enabled: z.boolean({ error: 'must be true or false' }),
          })
          .strict(),
      })
      .strict(),
    database: z
      .object({
        file: z.string(required('a string')).min(1),
      })
      .strict(),
    logging: z
      .object({
        /** Unset: `debug` in development, `info` otherwise. */
        level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
        /** Log full LLM prompts and responses. Debugging only. */
        llmContent: z.boolean({ error: 'must be true or false' }).default(false),
      })
      .strict(),
    llm: z
      .object({
        thinking: ThinkingConfigSchema,
        decision: DecisionConfigSchema,
        /** How long provider reachability results are cached for /api/health. */
        healthCacheMs: z.number().int().min(0),
        /** Prices by model id, for the estimated cost on LLM log lines. */
        pricing: z.record(z.string().min(1), ModelPriceSchema).default({}),
      })
      .strict(),
    game: GameConfigSchema,
    dev: z
      .object({
        /** Mounts /api/dev/* outside production. */
        playground: z.boolean(),
      })
      .strict(),
    secrets: z
      .object({
        cookieSecret: secret,
        /** Required only while security.csrf.enabled is true. */
        csrfSecret: secret.optional(),
        anthropicApiKey: z.string().min(1).optional(),
        typesafeApiKey: z.string().min(1).optional(),
        layaApiKey: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict()
  // Cross-field rules. zod runs them only once every field above is valid, so these (conditional) problems
  // are reported in a second pass after the basic ones are fixed.
  .superRefine((config, ctx) => {
    const { secrets, llm, nodeEnv, security } = config;
    if (security.csrf.enabled && !secrets.csrfSecret) {
      ctx.addIssue({
        code: 'custom',
        message: 'is required when security.csrf.enabled is true',
        path: ['secrets', 'csrfSecret'],
      });
    }
    if (secrets.csrfSecret !== undefined && secrets.cookieSecret === secrets.csrfSecret) {
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
  })
  .transform((config) => ({
    ...config,
    logging: {
      ...config.logging,
      level: config.logging.level ?? (config.nodeEnv === 'development' ? 'debug' : 'info'),
    },
  }));

export type AppConfigInput = z.input<typeof AppConfigSchema>;
export type ParsedAppConfig = z.output<typeof AppConfigSchema>;
