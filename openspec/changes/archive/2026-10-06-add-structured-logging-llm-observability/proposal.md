## Why

The API already logs through Pino, but those logs stay on the box: Sentry receives exceptions and traces, not the log stream. Calls to Anthropic, the only paid dependency, leave no record of tokens, cost, latency, retries or rate limiting. Log lines written outside a request handler (for example inside the Anthropic provider) carry no request ID, so a slow or failed turn can't be traced back to the HTTP request that caused it. Redaction covers only a few headers, and two `console.error` calls still bypass the logger.

## What Changes

Existing and kept: one Pino logger built by `LoggerFactory` and injected through the `Container`, `pino-http` request logging, `X-Request-Id` handling, pretty output in development, and Sentry preloaded through `instrument.ts`.

- **Request context everywhere.** Each request's ID is stored in `AsyncLocalStorage`. A Pino `mixin` adds `requestId` to every log line written during that request, including lines from code that only holds the root logger, such as providers, the brain and repositories.
- **Log level defaults.** When `LOG_LEVEL` is unset, the level is `debug` in development and `info` in production. The `logging.level` key in the committed config file becomes optional so it no longer pins `info`.
- **Wider redaction.** Redaction now covers authorization headers, cookies, CSRF tokens, `x-api-key`, and any field named `password`, `token`, `secret`, `apiKey` (with its usual spellings) or `api_key`, at the top level and one level down.
- **Sentry log forwarding.**
  - `Sentry.pinoIntegration()` sends `info`, `warn` and `error` lines to Sentry Logs.
  - `error` and `fatal` lines become Sentry error events.
  - The `@sentry/node` floor is pinned at `>=10.18.0`. The installed version is 11.4.0.
  - In SDK v11, Sentry Logs are always on. The `enableLogs` option was removed, so passing it would fail the type check. The design records how this maps to the request to set `enableLogs: true`.
- **LLM call logging.** A thin `LlmCallLogger` wraps every Anthropic SDK call: `messages.create` and the `models.retrieve` ping. For each call it logs:
  - the model, `max_tokens`, temperature, effort and whether fallbacks are on;
  - token usage: input, output, cache read/write and total;
  - estimated cost in USD from a configurable price table;
  - latency, the Anthropic request ID and the HTTP `requestId`.
  - The prompt and response are left out by default.
- **Separate LLM events.**
  - `llm.rate_limited` (429) and `llm.overloaded` (529), each with its `retry-after` value.
  - `llm.retry`, with the attempt number. This covers the SDK's own retries, seen through an instrumented `fetch`, and the app's retry after invalid JSON.
  - `llm.timeout`, with the attempt number.
  - `llm.call_failed`, with the error type and status. It is logged at `error`, so it reaches Sentry as an error event.
  - A successful call is logged once, at `info`.
- **`LOG_LLM_CONTENT=true`.** This flag adds the full prompt (system and messages) and the response text to the LLM log lines. It is off by default and meant for debugging only.
- **No more console calls.** The two `console.error` calls in `main.ts` are replaced: a fatal config error is written by a minimal bootstrap logger, and the error from a failed `main()` goes to `logger.fatal`.
- **New environment variables:** `LOG_LLM_CONTENT`. Behavior changes for the existing `LOG_LEVEL`. Both are documented in `.env.example`.

Nothing here is a breaking API change. The HTTP response shapes stay the same.

## Capabilities

### New Capabilities
- `error-monitoring`: how the API reports to Sentry: initialized before anything else, Pino lines forwarded as Sentry Logs, error and fatal lines captured as events, and the SDK version floor.
- `llm-call-logging`: structured, correlated, cost-aware logging of every Anthropic API call. Covers the success record, the rate-limit, overload, retry, timeout and failure events, and the content toggle.

### Modified Capabilities
- `api-foundation`: the "Request ID" requirement now also covers log lines written outside a request handler. "Structured logging with redaction" gains level defaults per environment, the wider redaction list, and a rule that no output goes through `console`.
- `app-config`: "Environment overrides" adds `LOG_LLM_CONTENT`. `LOG_LEVEL` falls back to a default for the environment.

## Impact

- **Code (apps/api):**
  - `src/logging/` gains `RequestContext.ts`, `LlmCallLogger.ts` and `LlmPricing.ts`. `LoggerFactory.ts` changes.
  - Changed: `src/instrument.ts` (pino integration), `src/main.ts`, `src/http/ApiServer.ts` (request context middleware), `src/llm/thinking/AnthropicThinkingProvider.ts`, `src/llm/thinking/ThinkingProvider.ts` (JSON-retry hook), and the config files `AppConfigSchema.ts` and `ConfigLoader.ts`.
- **Config:**
  - `config/app.config.json`: `logging.level` is removed (it becomes optional) and a `logging.llmContent` default and an `llm.pricing` table are added.
  - `.env.example` gains `LOG_LLM_CONTENT`.
- **Dependencies:** none new. Pino 10, pino-http 11 and pino-pretty 13 are already installed. `@sentry/node` 11.4.0 already meets the 10.18.0 floor.
- **Sentry:** log volume goes up, because every `info` line now becomes a Sentry log. Errors that are already captured by the Express handler may also arrive through `logger.error`. The design covers how duplicates are avoided.
- **Tests:** tests for `LoggerFactory` redaction and levels, `LlmCallLogger`, `RequestContext`, and the Anthropic provider using the existing `stubFetch`.
