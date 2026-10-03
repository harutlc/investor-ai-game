## 1. Dependencies & shared contracts

- [x] 1.1 Add `@anthropic-ai/sdk`, `@typesafe-ai/sdk` and `ollama` to `apps/api`. Inspect the installed type definitions for `client.beta.messages.parse`, `zodOutputFormat` (`@anthropic-ai/sdk/helpers/zod`), the `fallbacks` param typing, `TypeSafeClient` options and `Ollama` constructor `fetch` support. Record the findings (the parse vs create fallback path) in a code comment. Verify `pnpm install` and `pnpm typecheck` pass
- [x] 1.2 In `packages/shared`:
  - add `PROVIDER_UNAVAILABLE` and `PROVIDER_BAD_RESPONSE` to `ErrorCode`
  - extend `HealthDtoSchema` with `checks.thinking` / `checks.decision` (`ok | error`)
  - add playground request/response schemas (`PlaygroundTextRequest`, `PlaygroundJsonRequest`, `PlaygroundDecisionRequest` and their responses, with the length and size limits from the llm-playground spec)

  Verify with shared unit tests for the new codes, the health shape and playground limits (21 messages rejected, a 4001-character message rejected)

## 2. Configuration

- [x] 2.1 Generalize `ConfigLoader` env overrides to dotted paths of any depth, matching issue names to the longest overridden prefix. Verify the existing config tests still pass, plus a new test: an invalid `OLLAMA_BASE_URL` is reported as `llm.thinking.providers.ollama.baseUrl (from OLLAMA_BASE_URL)`
- [x] 2.2 Extend `AppConfigSchema` with the `llm` (thinking/decision provider blocks, `healthCacheMs`) and `dev.playground` sections from design §6. Add `secrets.anthropicApiKey` / `typesafeApiKey` / `layaApiKey`. Require the key only for the active provider (`superRefine`, path mapped to the env var name), and reject `fake` in production. Add the overrides `THINKING_PROVIDER`, `DECISION_PROVIDER`, `OLLAMA_BASE_URL` and `LAYA_BASE_URL`. Verify these tests:
  - env selects a provider
  - unknown provider names `llm.thinking.provider`
  - `anthropic` without `ANTHROPIC_API_KEY` fails naming it
  - `ollama` without `ANTHROPIC_API_KEY` succeeds
  - `jev` without `TYPESAFE_API_KEY` fails
  - `laya` without `LAYA_API_KEY` succeeds
  - `fake` in production fails
  - key values never appear in error messages
- [x] 2.3 Update `config/app.config.json`, `.env.example` and `test/support/testConfig.ts` (fake providers by default). Verify the full existing test suite still passes

## 3. Shared LLM infrastructure

- [x] 3.1 Implement `ProviderUnavailableError` (503) and `ProviderBadResponseError` (502) as `AppError` subclasses. Verify the status/code mapping in `test/errors/AppError.test.ts`
- [x] 3.2 Implement `JsonResponseParser`: strip Markdown fences, `JSON.parse`, `schema.safeParse`, and return either the data or a compact issue description for the retry prompt. Verify unit tests: plain JSON, ```` ```json ```` fence, bare ```` ``` ```` fence, leading prose before the fence, invalid JSON, and a schema mismatch with readable issues
- [x] 3.3 Implement a small `withRetry(attempts, fn, isRetryable)` helper for Ollama (the SDKs bring their own). Verify unit tests: it retries only retryable errors, stops at the limit, and rethrows the last error

## 4. Thinking providers

- [x] 4.1 Define `ThinkingProvider` with `ChatMessage`, `TextResult` and `JsonResult<T>` types, plus a shared `generateJsonWithRetry` routine (first attempt → on parse/schema failure append the bad reply plus a correction turn → second attempt → `ProviderBadResponseError`). Verify unit tests with a stub attempt function: success first time, success on retry (and the correction turn contains the issues), failure twice
- [x] 4.2 Implement `FakeThinkingProvider`: a scripted reply queue, echo text by default, JSON only from the script, `ping()` always ok. Verify unit tests
- [x] 4.3 Implement `OllamaThinkingProvider`:
  - `chat` with system plus messages, `options.temperature` and `num_predict`, `format: z.toJSONSchema(schema)` in JSON mode
  - per-attempt `AbortSignal.timeout`, then `withRetry`
  - empty reply → bad response
  - `ping()` via `list()`, checking that the configured model is present
  - error mapping: connection, abort and 5xx → unavailable; 4xx → bad response

  Verify tests with an injected `fetch` stub: request body shape (model, format schema, options), trimmed text, fenced JSON parsed, retry on invalid JSON, `ECONNREFUSED` → `PROVIDER_UNAVAILABLE`, timeout → `PROVIDER_UNAVAILABLE`, missing model → ping fails
- [x] 4.4 Implement `AnthropicThinkingProvider`:
  - text via `(beta.)messages.create` with `output_config.effort`, joining text blocks
  - JSON via `messages.parse` + `zodOutputFormat`, or the fallback path from task 1.1
  - `fallbacks: 'default'` + beta header when enabled
  - refusal → bad response
  - `ping()` via `models.retrieve(model)`
  - typed SDK errors mapped per design §5
  - no `temperature` sent

  Verify tests against a stubbed `fetch` (the SDK accepts one, so no stub server is needed):
  - the request contains the model, max_tokens, effort, `fallbacks: "default"` and the `anthropic-beta` header, and no `temperature`
  - text joined
  - parsed JSON returned
  - `stop_reason: "refusal"` → `PROVIDER_BAD_RESPONSE`
  - 529/connection refused → `PROVIDER_UNAVAILABLE`
  - 401 → `PROVIDER_UNAVAILABLE`, with a log line naming `ANTHROPIC_API_KEY` but not its value
- [x] 4.5 Implement `ThinkingProviderFactory` (an exhaustive switch). Verify tests: each name builds the right class with its settings, and an unknown name throws

## 5. Decision providers

- [x] 5.1 Implement the decision types (zod schemas for state, choice/noul/score questions with limits and normalized answers, in `packages/shared`; the `QuestionSet` input type and `DecisionResult<Q>` typing in `DecisionProvider.ts`) and the `DecisionProvider` interface. Verify unit tests: 150 options rejected, 1 score level rejected, 11 rejected, empty question map rejected, a type-level test that `result.answers.reaction.value` is the label union
- [x] 5.2 Implement `DecisionAnswerMapper`: wire answers → normalized answers, with checks for missing keys, type mismatches and unknown labels. Verify unit tests covering each primitive and each failure (→ `ProviderBadResponseError`)
- [x] 5.3 Implement `FakeDecisionProvider`: scripted answers, otherwise deterministic defaults (first label with uniform probabilities, noul 0.5, middle score level, confidence 1), and `decideMany` in order. Verify unit tests
- [x] 5.4 Implement `SystemOneDecisionProvider` (Jev and Laya):
  - a `TypeSafeClient` with explicit `apiKey` (placeholder for keyless Laya), `baseURL`, `defaultModel`, `timeout`, `retry`, `logLevel: 'warn'`, a pino logger, and an injected `fetch`
  - question validation before sending
  - mapper, latency and usage
  - `decideMany` via `Promise.all`
  - `ping()`: Jev `models.list()`, Laya `GET /health` with an optional bearer token
  - SDK error mapping per the decision-llm spec

  Verify tests with a `fetch` stub:
  - request path, body (state, questions, model) and auth header
  - normalized answers for a mixed question set
  - 3 parallel requests return in order
  - 401 / 429 / `APIConnectionError` → `PROVIDER_UNAVAILABLE`
  - 422 → `PROVIDER_BAD_RESPONSE`
  - unknown label → `PROVIDER_BAD_RESPONSE`
  - no real bearer token sent to Laya without a key
- [x] 5.5 Implement `DecisionProviderFactory`. Verify tests: `jev` and `laya` get the right baseURL, model and key; `fake` builds; an unknown name throws

## 6. Wiring & health

- [x] 6.1 Wire the factories into `Container` with `thinkingProvider` / `decisionProvider` overrides, and expose both providers. Verify `createTestApp` builds with fake providers by default and with injected ones
- [x] 6.2 Implement `ProviderHealthMonitor`:
  - parallel pings with a 3 s timeout
  - `ok` / `error` mapping
  - TTL cache from `llm.healthCacheMs`
  - a shared in-flight promise
  - failures logged at warn with the provider name

  Verify unit tests with a fake clock: the result is cached within the TTL and refreshed after it, concurrent calls share one ping, and a hanging ping becomes `error` after the timeout
- [x] 6.3 Make `HealthService.check()` async and include `checks.thinking` / `checks.decision`. Update `HealthController`. Verify `test/api/health.test.ts`:
  - all ok → 200
  - thinking ping failing → 200 with `checks.thinking: "error"`
  - DB closed → 503
  - two calls within the TTL ping once
  - the body has no provider, model or URL strings

## 7. Dev playground

- [x] 7.1 Implement `PlaygroundController` (`/dev/thinking/text`, `/dev/thinking/json` with `z.fromJSONSchema` and a depth/size guard, `/dev/decision`) using the shared schemas and `ValidationMiddleware`. Mount it in `Container` only when `dev.playground && !isProduction`. Verify `test/api/playground.test.ts` with fake or scripted providers:
  - text reply 200
  - JSON reply conforms to the posted schema
  - an invalid JSON Schema → 400 `VALIDATION_ERROR`
  - decision answers returned
  - no CSRF token → 403
  - `dev.playground: false` → 404
  - production → 404
  - a provider throwing `ProviderUnavailableError` → 503 envelope without secrets

## 8. Docs & verification

- [x] 8.1 Update `README.md`:
  - the two LLM roles (decision = brain, thinking = voice)
  - running Ollama (`ollama pull llama3.1:8b`) and laya-serve (`pip install "laya[serve]" && laya-serve`)
  - using Jev (`TYPESAFE_API_KEY`) and Anthropic (`ANTHROPIC_API_KEY`)
  - switching providers through config or env
  - the health fields
  - the playground with curl examples (session cookie, CSRF token, POST)
  - the note that Jev and Laya confidence values aren't comparable

  Verify the commands by running them against the fake providers
- [x] 8.2 Run the full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Then run `pnpm dev` with `THINKING_PROVIDER=fake DECISION_PROVIDER=fake` and exercise `/api/health` and all three playground endpoints with curl. If a local Ollama or laya-serve is available, repeat one text call and one decision call against it. Record the outcome
