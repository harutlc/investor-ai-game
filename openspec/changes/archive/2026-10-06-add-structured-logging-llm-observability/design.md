## Context

The request describes a JavaScript layout, but the target is the TypeScript monorepo's API (`apps/api`), which already has most of the basics:

- `src/logging/LoggerFactory.ts` builds one Pino 10 logger. It pretty-prints in development and redacts four header paths.
- `Container` creates that logger once and injects it everywhere. No module creates its own logger.
- `ApiServer` mounts `RequestIdMiddleware` and then `pino-http` with `genReqId` set to the request ID. `req.log` is scoped to the request, but providers, the brain and repositories only receive the root logger, so their lines have no `requestId`.
- `src/instrument.ts` is preloaded with `node --import` (in the dev and start scripts and the Dockerfile) and calls `Sentry.init`. `@sentry/node` is at 11.4.0. Express errors with status ≥500 are reported by `Sentry.setupExpressErrorHandler`. AppErrors carry their own status, so the 503 from `ProviderUnavailableError` is reported too.
- `AnthropicThinkingProvider` is the only Anthropic call site. It makes two kinds of call:
  - `client.beta.messages.create` (from `generateText` and `generateJson`);
  - `client.models.retrieve` (from `ping`).
- The SDK client is built with `timeout`, `maxRetries` and an injectable `fetch` (`deps.fetch`, which tests use). The SDK retries 408/409/429/5xx and connection errors internally, and nothing is logged when it does. `generateJsonWithRetry` adds one retry at the application level when the JSON is invalid.
- `logging.level` is required in the schema and set to `info` in `config/app.config.json`. `LOG_LEVEL` overrides it.
- `console.error` is used in exactly two places, both in `main.ts`: the config-error exit and the final `main().catch`.

Facts checked against installed packages:

- `@sentry/node` 11.4.0 exports `pinoIntegration({ log: { levels }, error: { levels, handled } })`.
- In v11 there is no `enableLogs` option: the core options type has `beforeSendLog` but no logs toggle, and log capture is gated only on a client being present. Logs are on by default.
- `@anthropic-ai/sdk` 0.131 exposes `RateLimitError`, `InternalServerError`, `APIConnectionTimeoutError` and similar error classes. It reads `retry-after-ms` and `retry-after`. Its retry loop calls the configured `fetch` once per attempt.

## Goals / Non-Goals

**Goals:**
- Keep the existing pattern of one factory-built logger injected by the `Container`, and add request correlation and Sentry forwarding without changing any constructor signatures.
- Have the LLM logging see every attempt, including SDK-internal retries, without turning off the SDK's retry logic.
- Keep everything testable offline with the existing `stubFetch` and `captureLogger` helpers.

**Non-Goals:**
- Logging calls to Ollama, Laya or TypeSafe (Jev). The wrapper is written so it could cover them later, but this change only wires up Anthropic, as requested.
- Sentry AI/LLM monitoring spans (`anthropicAIIntegration`). They are complementary, but they're a separate signal and out of scope. See Open Questions.
- Shipping logs anywhere other than stdout and Sentry, or rotating log files.
- Changes to the web app's logging.

## Decisions

### D1. Keep `LoggerFactory` plus DI and don't add a `lib/logger.js` singleton
The request asks for "a single reusable logger module that the rest of the app imports". `LoggerFactory.create(config)` called once in `Container` already meets that intent, and tests depend on injecting a capture logger (`Container` overrides, `captureLogger`). A module-level singleton would need config at import time and would make test isolation harder. The factory module stays the single place where the logger is configured.
*Alternative:* an exported singleton `logger`. Rejected because it fights the existing DI and ConfigLoader ordering.

### D2. Request context through `AsyncLocalStorage` and a Pino `mixin`
`src/logging/RequestContext.ts` holds an `AsyncLocalStorage<{ requestId: string }>`. The middleware runs right after `RequestIdMiddleware` and wraps `next()` in `requestContext.run({ requestId }, next)`. `LoggerFactory` sets `mixin: () => requestContext.get() ?? {}`, so every line from any logger, including the root logger and child loggers, gets `requestId` while a request is in flight.

`pino-http` already adds `req.id`. To avoid writing the ID twice, its `customProps` is left alone and the mixin is the only source of `requestId`. The Pino option `mixinMergeStrategy` is left at its default, so explicit fields win.

The same ALS gives the request ID to the `LlmCallLogger` and to Sentry (D5).

*Alternative:* pass `req.log` down to every service. Rejected because it touches every signature, and the game services are not request-scoped objects.

### D3. Log level and redaction in `LoggerFactory`
- `logging.level` becomes optional in `AppConfigSchema`, and the line is removed from `config/app.config.json`. `AppConfig.logging.level` is resolved in the loader as `level ?? (nodeEnv === 'development' ? 'debug' : 'info')`, so the factory still receives a concrete level. `test` keeps whatever level the test config sets.
- Redaction paths are built from a list of keys. Pino's redaction has no recursive wildcard, so each key is listed as `key`, `*.key` and the header forms (`req.headers.*`, `res.headers["set-cookie"]`):
  - headers: `cookie`, `authorization`, `x-csrf-token`, `x-api-key`, and `set-cookie` on responses;
  - fields: `password`, `token`, `accessToken`, `refreshToken`, `secret`, `apiKey`, `api_key`, `authorization`.

  The censor stays `[Redacted]`. Depth is limited to one level by design, as the spec states. Deeper secrets are prevented by never logging config or secrets objects (see the risks).
- The development transport (`pino-pretty`) is unchanged. Production writes JSON to stdout.

### D4. Sentry: `pinoIntegration` in `instrument.ts`
```ts
integrations: [Sentry.pinoIntegration({ log: { levels: ['info', 'warn', 'error'] }, error: { levels: ['error', 'fatal'], handled: true } })]
```
`autoInstrument` stays at its default (`true`). It works because `instrument.ts` is preloaded before `pino` is first imported. The same constraint already applies to Sentry's Express instrumentation.

**`enableLogs`.** On the installed v11 SDK this option no longer exists, and logs are on by default. Writing `enableLogs: true` would be a TypeScript excess-property error. The request's intent, which is that logs are enabled, holds without it. A comment in `instrument.ts` records this.

If the SDK is ever pinned back to the v10 line (≥10.18.0), `enableLogs: true` must be added. To keep the version floor explicit, `@sentry/node` stays as `^11.4.0` in `package.json`, and a unit test asserts that the installed major version is ≥10 and that `pinoIntegration` is exported.

`fatal` is left out of `log.levels` because the request listed only info, warn and error. `fatal` lines still become error events.

### D5. One Sentry event per failure
After D4, a 500 caused by an unexpected error would be reported twice: once by `setupExpressErrorHandler` and once by `ErrorHandlerMiddleware`'s `log.error({ err })`. An LLM failure would also be reported twice: `llm.call_failed` with the SDK error, and the Express handler with the wrapping `ProviderUnavailableError`.

Decision: logging is the one reporting path.
- `setupExpressErrorHandler` is removed. In v11 it takes no options and does only two things: it captures errors with status ≥500, and it attaches request data, which the HTTP integration already provides.
- `ErrorHandlerMiddleware` logs at `error`, which produces the event:
  - non-AppErrors;
  - AppErrors with status ≥500, unless the error or its `cause` is in `ReportedErrors`. That set is a WeakSet, and the `LlmCallLogger` marks the SDK errors it has already reported through `llm.call_failed`. Ollama, Laya and Jev failures that reach the handler are therefore still reported, as they were before, and Anthropic failures are reported once, with the LLM context.
- 4xx AppErrors stay at `warn`.
- pino-http request lines are capped at `warn`. A 5xx `request errored` line at `error` would add a second event built from a generic "failed with status code 500" error.
- Sentry's default Dedupe integration also drops consecutive identical events. This is SDK behavior and is kept.

The request ID is attached to each event through `Sentry.getIsolationScope().setTag('request_id', id)` in the same request-context middleware.

*Alternative:* keep the Express handler and log non-AppErrors at `warn`. Rejected because errors outside requests (startup, timers) would lose their events.

### D6. `LlmCallLogger`: one wrapper around the SDK client
`src/logging/LlmCallLogger.ts` exposes:
- `run<T>(meta, fn: () => Promise<T>): Promise<T>`. `meta` holds the provider, requested model, maxTokens, temperature, effort, fallbacks, operation (`generate` or `ping`) and the prompt for content logging.
- `instrumentFetch(fetch): typeof fetch`.

`AnthropicThinkingProvider` builds its client with `fetch: llmCallLogger.instrumentFetch(deps.fetch ?? globalThis.fetch)` and wraps both `client.beta.messages.create` and `client.models.retrieve` in `run`. This is the only change at the call site. Any future method on the provider must go through the private `complete` or `ping`, which already call `run`.

How it works:
- `run` opens a per-call `AsyncLocalStorage` frame `{ attempt: 0, startedAt, meta }`. The SDK calls `fetch` inside the async context of `create()`, so the instrumented fetch finds that frame.
- **Each attempt** increments `attempt`. If `attempt > 1`, it logs `llm.retry` with a `reason` taken from the previous attempt's outcome (`status_429`, `status_529`, `status_5xx`, `connection`, `timeout`).
- **Response status 429 or 529:** logs `llm.rate_limited` or `llm.overloaded`, reading the `retry-after` and `retry-after-ms` headers from a cloned header set. The body is never read.
- **Fetch throws an `AbortError`** after the SDK's timeout: logs `llm.timeout` with the attempt and `settings.timeoutMs`.
- **`run` on success:** reads `usage` and `model` from the response, computes the cost, and logs `llm.call` at `info` with `attempts`.
- **`run` on failure:** logs `llm.call_failed` at `error`, with `errorType = error.constructor.name`, `status`, `attempts` and `anthropicRequestId` (`error.requestID`), then rethrows unchanged. The provider's existing `toProviderError` still maps the error. Its separate `warn`/`error` lines for the same failure are removed, so a failure appears once.
- **Refusal:** `complete()` already detects `stop_reason === 'refusal'`. It calls `llmCallLogger.refusal(...)`, which logs `llm.call_failed` with `errorType: 'Refusal'` and the category, instead of its current `warn`.
- **Ping:** pings log `llm.call` with `operation: 'ping'` at `debug` instead of `info`. Health probes run every `healthCacheMs` and would otherwise flood Sentry Logs. Ping failures still log `llm.call_failed` at `error`. This deviates slightly from "successful calls at info" and is recorded here because pings are not generation calls. The spec's success record applies to generation.
- **Invalid-JSON retry:** `generateJsonWithRetry` gains an optional `onRetry(reason)` callback. The Anthropic provider passes one that logs `llm.retry` with `reason: 'invalid_json'`. Each underlying call is still its own `run`.

*Alternatives:*
- Set `maxRetries: 0` and retry in our own code. Rejected because it duplicates the SDK's backoff and retry-after logic.
- Use the SDK's `logger` option. Rejected because it gives free-text messages without attempt numbers and would couple us to the SDK's log format.

### D7. Pricing table in config
Add `llm.pricing` to `AppConfigSchema` as a record keyed by model ID. Each entry is `{ inputPerMTok, outputPerMTok, cacheReadPerMTok, cacheWritePerMTok }` in USD. Seed `config/app.config.json` with the list prices as of 2026-09:

| model | input | output | cache read | cache write (5 min) |
|---|---|---|---|---|
| claude-opus-5-5 | 4.00 | 20.00 | 0.20 | 5.00 |
| claude-sonnet-5-5 | 2.00 | 10.00 | 0.20 | 2.50 |
| claude-haiku-4-5 | 1.00 | 5.00 | 0.10 | 1.25 |

`LlmPricing.estimate(model, usage)` returns `costUsd`, rounded to 6 decimals, or `null`. A model that is not in the table logs one `warn` per process. The price is looked up with the served `response.model`, so fallback-served turns are priced correctly.

Cache-write tokens are all priced at the 5-minute rate. This app never sets a 1-hour TTL.

*Alternative:* hard-code the prices. Rejected because prices change and the config is already validated at startup.

### D8. `LOG_LLM_CONTENT`
Add `logging.llmContent: boolean`, which defaults to `false` and is overridden by `LOG_LLM_CONTENT` through the existing env-mapping table. `ConfigLoader` already parses booleans this way for `CSRF_ENABLED`. When the flag is on, `LlmCallLogger` adds `prompt: { system, messages }` and `response: { text }`.

These fields pass through redaction like everything else, but prompts are free text. That is why the flag is debug-only, and `instrument.ts`'s `beforeSendLog` drops `prompt` and `response` attributes from Sentry Logs when `NODE_ENV === 'production'`. This is a safety net: content can still be inspected locally, but player text doesn't reach Sentry from production by accident.

### D9. Replacing the console calls
- `main.ts#loadConfig`: on a `ConfigError`, the real logger doesn't exist yet. A bootstrap logger, `pino({ level: 'info' })` from a new `LoggerFactory.bootstrap()`, writes `fatal({ err: { message } }, 'invalid configuration')`. The process then flushes Sentry and exits 1. The message names the keys, as the app-config spec requires.
- `main().catch`: becomes `logger.fatal(...)` when the container exists and the bootstrap logger otherwise. The explicit `Sentry.captureException` is removed, because the fatal line now creates the event (D4), and `Sentry.flush` is kept.
- A lint guard, `no-console: 'error'` for `apps/api/src/**` in `eslint.config.js`, keeps it this way. Scripts and the web app are out of scope.

## Risks / Trade-offs

- **More Sentry Logs volume and cost**, because every request line at `info` is forwarded. → `beforeSendLog` drops request-completed lines for `/api/health`. They stay in local logs, because api-foundation requires a log line for every request. If volume becomes a problem, the same hook can sample other lines. Operators can see the volume in the Sentry usage page after deploy.
- **ALS context loss.** Callbacks scheduled outside the request's async chain (for example `setTimeout` created at startup) won't carry the ID. That is correct behavior. → Tests cover concurrent requests and provider lines.
- **Pino auto-instrumentation.** It was expected to depend on preload order, but verified that it does not: in SDK v11 it subscribes to pino 10's `pino_asJson` diagnostics channel, so every logger is covered whatever the import order. → An integration test asserts that the integration is registered and that lines arrive.
- **The fetch wrapper relies on the SDK calling `fetch` once per attempt.** This is true in 0.131, but an SDK upgrade could change it. → The provider test with `stubFetch` (429 then 200) pins the behavior and fails loudly if it changes.
- **The cost estimate is not the bill.** It leaves out fallback-credit repricing, batch discounts and taxes. → The field is named `costUsd`, documented as estimated, and the prices are configurable.
- **One-level redaction depth.** A secret nested deeper would leak. → Config and secrets objects are never logged, and the redaction test covers the listed keys at both depths.
- **Switching Sentry reporting to logs only (D5)** changes where events come from. Grouping in Sentry may change once (new fingerprints). → This is acceptable; note it in the deploy notes.

## Migration Plan

1. Deploy as usual with `scripts/deploy`. No infrastructure change is needed.
2. `LOG_LEVEL` is not set in production `.env`/SSM. With the config default removed, production stays at `info`.
3. Leave `LOG_LLM_CONTENT` unset in production.
4. Rollback: redeploy the previous image tag. Nothing persistent changes.

## Open Questions

- Should Sentry's `anthropicAIIntegration` (gen_ai spans) also be turned on for trace-level LLM visibility? It is independent of this change and can be added later without changing these specs.
