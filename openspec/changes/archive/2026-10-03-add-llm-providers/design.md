## Context

The project base is in place (archived change `2026-10-03-add-api-project-base`):
- Express 5 API with controller → service → repository layering, manual DI in `Container`, and zod-validated config from `ConfigLoader` (JSON file + `.env`, deep-frozen).
- A central `ErrorHandlerMiddleware` that maps `AppError` subclasses to `{ error: { code, message, details?, requestId } }`, with `ErrorCode` defined in `packages/shared`.
- `HealthService.check()`, currently synchronous and checking the database only.

The user decided:
- The thinking LLMs are **Ollama** and **Anthropic**; the decision LLMs are **Jev** and **Laya** (Laya over HTTP via `laya-serve` only).
- An outage is **reported but never fatal**.
- A **dev playground API** is included.

Research findings that shape the design:
- **Laya** is wire-compatible with Jev: the same `POST /v1/systemone` shape. Its `model` field accepts `english` / `multilingual` / `typed-decisions`; unknown values fall back to auto-routing. Bearer auth applies only when `LAYA_API_KEY` is set. Choice questions are capped at 100 options, and Laya adds an `answer_confidence` field Jev doesn't have. Confidence is computed differently than in Jev, so thresholds don't transfer between them.
- **`@typesafe-ai/sdk` 0.6** (`TypeSafeClient`):
  - Takes `apiKey`, `baseURL`, `defaultModel`, `timeout`, `retry`, `logLevel`, `logger` and `fetch`. It falls back to `TYPESAFE_*` env vars.
  - Methods: `systemOne({ state, questions, model? })` and `models.list()`. There is no batch method.
  - Errors: `APIError` (`status`), `AuthenticationError`, `RateLimitError`, `UnprocessableEntityError`, `InternalServerError`, `APIConnectionError` and `APITimeoutError`.
- **`@anthropic-ai/sdk`**:
  - The default model is `claude-opus-5-5`. On current models `temperature` is rejected (400) and depth is set with `output_config.effort` (default `medium` on Opus 5.5).
  - Structured output uses `messages.parse` with `output_config.format = zodOutputFormat(schema)`.
  - A safety decline arrives as HTTP 200 with `stop_reason: "refusal"`. Server-side fallback is `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`.
  - Errors are typed (`RateLimitError`, `APIConnectionError`, …), and `timeout` is in milliseconds.
- **Ollama**:
  - `POST /api/chat` accepts `format` as a JSON Schema, and `options.temperature` / `options.num_predict`.
  - `GET /api/tags` lists the models that have been pulled. The official `ollama` npm client wraps both.
- **zod 4** provides `z.toJSONSchema` (needed for Ollama `format`) and `z.fromJSONSchema` (needed for the playground's JSON endpoint). Both were verified in the installed version.

## Goals / Non-Goals

**Goals:**
- Two small, stable contracts (`ThinkingProvider`, `DecisionProvider`) that the investor brain and dialogue code will depend on. They never import an SDK directly.
- Provider choice, endpoints and keys come from config + env only. Startup fails fast on bad config, never on unreachable services.
- Every provider is testable offline. Real SDK clients are created inside provider classes from injected options, and HTTP is stubbed in tests through each SDK's `fetch` option. All three SDKs accept one.

**Non-Goals:**
- Prompt design, persona tone and question catalogs (these belong to the investor-brain and dialogue changes).
- Decision logging to the database, and the confidence gate.
- Streaming responses, multi-provider fan-out, side-by-side Jev and Laya, and an OpenAI provider.
- In-process Laya (`laya-ts` isn't on npm).

## Decisions

### 1. Module layout
```
apps/api/src/llm/
  thinking/  ThinkingProvider.ts (interface + request/result types), OllamaThinkingProvider.ts,
             AnthropicThinkingProvider.ts, FakeThinkingProvider.ts, ThinkingProviderFactory.ts
  decision/  DecisionProvider.ts (interface, readonly QuestionSet input type, typed results, request validation),
             SystemOneDecisionProvider.ts (Jev + Laya), FakeDecisionProvider.ts,
             DecisionAnswerMapper.ts, DecisionProviderFactory.ts
packages/shared/src/decision/DecisionSchemas.ts   zod schemas for questions (with limits) and normalized answers
  JsonResponseParser.ts           strip fences → JSON.parse → schema.safeParse → issue text for retry
  ProviderHealthMonitor.ts        cached reachability checks for both active providers
  errors/  ProviderUnavailableError.ts (503), ProviderBadResponseError.ts (502)
apps/api/src/http/controllers/PlaygroundController.ts
```
This follows the project conventions: one class per file, and constructor injection.

### 2. Contracts
```ts
interface ThinkingProvider {
  readonly name: 'ollama' | 'anthropic' | 'fake';
  readonly model: string;
  generateText(req: { system?: string; messages: ChatMessage[] }): Promise<TextResult>;      // { text, provider, model, latencyMs }
  generateJson<T>(req: { system?: string; messages: ChatMessage[]; schema: z.ZodType<T> }): Promise<JsonResult<T>>;
  ping(): Promise<void>;                                                                       // throws on failure
}
interface DecisionProvider {
  readonly name: 'jev' | 'laya' | 'fake';
  decide<Q extends DecisionQuestions>(req: { state: DecisionState; questions: Q }): Promise<DecisionResult<Q>>;
  decideMany(reqs: DecisionRequest[]): Promise<DecisionResult[]>;                              // Promise.all, ordered
  ping(): Promise<void>;
}
```
- **No `temperature` in the shared request.** Anthropic rejects sampling parameters on current models, so sampling is set per provider in config (Ollama `temperature`, Anthropic `effort`). `TASKS.md` §6.1 assumed a shared temperature; that changes here.
- **Typed answers.** `DecisionResult<Q>` maps each question key to an answer type (`ChoiceAnswer<labels>`, `NoulAnswer`, `ScoreAnswer`), so later code gets compile-time answer names. These are our own types, so the SDK's types never leave the provider.
  - *As implemented:* the zod schemas for questions and answers live in `packages/shared`, because the playground request DTOs (also in shared) need them.
  - Providers accept a readonly `QuestionSet` type, so question sets can be declared `as const` and keep literal labels. `validateDecisionRequest` runs the shared schemas at runtime. The shapes are:
  - choice: `{ type: 'choice', value, confidence, probabilities }`
  - noul: `{ type: 'noul', probability }`
  - score: `{ type: 'score', value, confidence, probabilities }`

  Laya's `answer_confidence` is dropped for now (YAGNI). The mapper is the single place to add it later.

### 3. Jev and Laya share one implementation
`SystemOneDecisionProvider(name, options)` wraps a `TypeSafeClient` built with explicit `apiKey`, `baseURL`, `defaultModel`, `timeout`, `retry: { maxRetries }`, `logLevel: 'warn'`, a pino-backed `logger`, and an optional `fetch`. Every value is passed explicitly: `ConfigLoader` reads `.env` without writing it into `process.env`, so the SDK's own `TYPESAFE_*` fallbacks would miss `.env` values and could pick up stray shell variables.

| | Jev | Laya |
|---|---|---|
| `baseURL` | `https://api.typesafe.ai` | `http://localhost:8000` (`LAYA_BASE_URL`) |
| `model` | `jev-latest` | `english` (or `multilingual` / `typed-decisions`) |
| key | `TYPESAFE_API_KEY` (required) | `LAYA_API_KEY` (optional; placeholder `"unused"` when unset, which Laya ignores without auth) |
| `ping()` | `client.models.list()`: checks the key | `fetch(baseURL + '/health')`, with a bearer token when a key is set |

Before any request, questions are validated against `DecisionQuestionsSchema`: 2–100 choice options (Laya's limit, and stricter than Jev's 255) and 2–10 score levels. `DecisionAnswerMapper` checks that every answer key exists, that each answer's type matches its question's type, and that every choice label belongs to the question's criteria. A mismatch raises `ProviderBadResponseError`.

Alternative considered: hand-written `fetch` for Laya. That would duplicate retries, timeouts and typed errors the SDK already provides, and the wire-compatibility is documented by Laya. If the two diverge later, a Laya-specific subclass can override `decide`.

### 4. Thinking providers
- **Ollama** (`ollama` package, `new Ollama({ host, fetch })`):
  - Text: `chat({ model, messages: [system?, ...messages], stream: false, options: { temperature, num_predict: maxTokens } })`.
  - JSON: the same call plus `format: z.toJSONSchema(schema)`, then `JsonResponseParser`.
  - Timeouts: an `AbortSignal.timeout(timeoutMs)` per attempt, wrapped by a small retry helper. The Ollama client has no built-in retry.
  - `ping()`: `list()` (`/api/tags`), then check that `model` is present. A missing model gives an actionable log message ("run `ollama pull llama3.1:8b`").
- **Anthropic** (`new Anthropic({ apiKey, baseURL?, timeout, maxRetries })`):
  - Text: `messages.create({ model, max_tokens, system, messages, output_config: { effort } })`, joining the `text` blocks.
  - JSON (*as implemented*): `messages.parse` throws when the output fails the schema, which loses the raw text the retry needs. Instead, the `{ type: 'json_schema', schema }` produced by `betaZodOutputFormat(schema)` is sent through `beta.messages.create`. That is the same output constraint, and the result is validated by `JsonResponseParser` through the shared retry-once path, like every other provider.
  - When `fallbacks` is enabled (the default), both calls go through `client.beta.messages.*` with `betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'`, so a classifier decline is re-run on Anthropic's recommended model. If the installed SDK has no `beta.messages.parse`, JSON mode uses `beta.messages.create` with the same `output_config.format` and validates with zod itself.
  - `stop_reason === 'refusal'` (after any fallback) → `ProviderBadResponseError`.
  - Defaults: model `claude-opus-5-5` and effort `low`, since investor replies are short chat turns where latency matters. Both are configurable. `maxTokens` defaults to 2048.
  - `ping()`: `models.retrieve(model)`. That checks both the key and the model id, with no token spend.
- **Retry-once for JSON** (all providers): when the parser or schema fails, append the bad reply as an assistant turn plus a user turn "Your previous reply was invalid: <zod issues>. Reply with JSON only." and call once more. A second failure → `ProviderBadResponseError` (the raw text goes to debug logs, not to the response).
- **Fake providers**:
  - `FakeThinkingProvider` takes a queue of scripted replies. Without a script it echoes text (`[fake] <last user message>`) and fails JSON requests with a bad-response error.
  - `FakeDecisionProvider` takes scripted answers. Otherwise it answers deterministically: the first choice label with uniform probabilities, noul 0.5, and the middle score level.
  - Both are allowed in development and test only.

### 5. Error mapping
A provider error mapper per SDK (a private method in each provider) converts SDK errors into two `AppError` subclasses:
- `ProviderUnavailableError` → 503 `PROVIDER_UNAVAILABLE`. Covers connection errors, timeouts, 429, 529, 5xx, and 401/403. Auth problems are deployment issues, not bad requests from the player, and the log line says "check <KEY_NAME>".
- `ProviderBadResponseError` → 502 `PROVIDER_BAD_RESPONSE`. Covers 400/422 from the backend, malformed bodies (the TypeSafe SDK's base `TypeSafeError`), schema or JSON failures after the retry, refusals, and unknown labels.

Messages are generic ("Thinking provider is unavailable"). The provider name and the SDK error's status and request id go to the structured log, never into the response. `ErrorCode` in `packages/shared` gains both codes.

### 6. Configuration
`config/app.config.json` gains:
```json
"llm": {
  "thinking": {
    "provider": "ollama",
    "providers": {
      "ollama":    { "baseUrl": "http://localhost:11434", "model": "llama3.1:8b", "temperature": 0.8, "maxTokens": 1024, "timeoutMs": 60000, "maxRetries": 1 },
      "anthropic": { "model": "claude-opus-5-5", "maxTokens": 2048, "effort": "low", "fallbacks": true, "timeoutMs": 60000, "maxRetries": 2 },
      "fake": {}
    }
  },
  "decision": {
    "provider": "laya",
    "providers": {
      "laya": { "baseUrl": "http://localhost:8000", "model": "english", "timeoutMs": 10000, "maxRetries": 2 },
      "jev":  { "baseUrl": "https://api.typesafe.ai", "model": "jev-latest", "timeoutMs": 10000, "maxRetries": 2 },
      "fake": {}
    }
  },
  "healthCacheMs": 30000
},
"dev": { "playground": true }
```
- **Env overrides**: `THINKING_PROVIDER`, `DECISION_PROVIDER`, `OLLAMA_BASE_URL`, `LAYA_BASE_URL`.
- **Secrets**: `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY` and `LAYA_API_KEY` go into `secrets.*`. Only the *active* provider's required key is enforced, via `superRefine`, with the error path mapped to the env var name. `fake` is rejected when `nodeEnv === 'production'`.
- **`ConfigLoader` changes**: `ENV_OVERRIDES` and the internal `set()` currently handle only two-level paths (`section.key`). They are generalized to dotted paths of any depth, and issue names match the longest overridden prefix (e.g. `llm.thinking.providers.ollama.baseUrl (from OLLAMA_BASE_URL)`).
- **Playground**: `dev.playground` is committed as `true` for a smooth local loop. Production can't enable it (the route is not mounted when `isProduction`), so no config validation is needed.
- `.env.example` documents every new variable.

### 7. Wiring
`Container` builds the providers with `ThinkingProviderFactory.create(config, { logger, fetch? })` and `DecisionProviderFactory.create(...)`. Both factories `switch` over the provider name and assert exhaustiveness. Container overrides gain `thinkingProvider?` and `decisionProvider?`, so tests inject fakes directly. The providers are exposed on the container for the future investor-brain and dialogue services.

### 8. Health
- `HealthService.check()` becomes `async`, and Express 5 handles the promise.
- It calls `ProviderHealthMonitor.status()`, which:
  - runs both `ping()`s in parallel, each raced against a 3 s timer (the providers' own pings also use 3 s request timeouts)
  - maps the outcomes to `'ok'` / `'error'`
  - caches the result for `llm.healthCacheMs`, keeping one in-flight promise so concurrent probes share a check
- `HealthDtoSchema` in shared gains `checks.thinking` and `checks.decision`. Only `checks.database` decides 200 vs 503. Failures are logged at `warn` with the provider name, which only goes to the logs.

### 9. Playground
`PlaygroundController` (basePath `/dev`) is added to the controller list only when `config.dev.playground && !config.isProduction`. Unmounted routes fall through to the existing 404.
- Request schemas live in `packages/shared` (`PlaygroundTextRequest`, `PlaygroundJsonRequest`, `PlaygroundDecisionRequest`, plus response DTOs), so a future dev UI can reuse them.
- `/thinking/json`: `z.fromJSONSchema(body.schema)` is wrapped in try/catch, and a failure becomes a `ValidationError` on `body.schema`. The schema must be an object no deeper than 10 levels with at most 50 properties, to bound the cost.
- The playground responds with the provider result as-is, and never echoes raw backend payloads.

## Risks / Trade-offs

- **[Jev and Laya confidence aren't comparable]** → Each answer records which provider produced it. The game-logic changes must calibrate thresholds per provider, as noted in the Laya docs.
- **[The SDK sends a placeholder bearer token to an unauthenticated Laya]** → It is harmless: Laya ignores auth when no key is configured. It's documented in a code comment and the README.
- **[A `messages.parse` / beta API difference in the installed Anthropic SDK]** → The fallback path (`beta.messages.create` + zod validation) is specified in Decision 4. A task checks the installed SDK's surface before coding.
- **[Small local models produce weak or invalid JSON]** → Ollama's `format` schema constraint, fence stripping and the retry-once path. Weak output is ultimately a prompt and model choice, out of scope here.
- **[Playground endpoints spend real money with Anthropic and Jev]** → They are dev-only, never mounted in production, require session + CSRF, and fall under the mutation rate limit (60 per 15 min).
- **[Health probes hitting paid APIs]** → Ping calls (`models.list` / `models.retrieve`) spend no tokens, and they're cached for 30 s.
- **[`dev.playground: true` committed in config]** → It's harmless outside production, because of the hard `isProduction` gate in `Container`. It's documented in the README.

## Migration Plan

This change adds to the config file. Existing deployments must:
1. Pull the new `config/app.config.json`. It has defaults for every provider.
2. Set `TYPESAFE_API_KEY` if they select `jev`, or `ANTHROPIC_API_KEY` if they select `anthropic`.

Rollback: revert the commit. No data migrations are involved.

## Open Questions

- Which Ollama model gives the best quality for its latency (for example `llama3.1:8b` or `qwen2.5:7b`)? That is a config value, tuned during the dialogue change.
