## 1. Config: log level default, content flag, pricing

- [x] 1.1 In `apps/api/src/config/AppConfigSchema.ts`, make `logging.level` optional, add `logging.llmContent: boolean` (default `false`), and add `llm.pricing` as a record of `{ inputPerMTok, outputPerMTok, cacheReadPerMTok, cacheWritePerMTok }` with non-negative numbers. Verify with `pnpm --filter @investor/api typecheck`.
- [x] 1.2 In `ConfigLoader.ts`:
  - resolve the log level as `level ?? (nodeEnv === 'development' ? 'debug' : 'info')`;
  - map `LOG_LLM_CONTENT` to `logging.llmContent` as a strict `true`/`false` boolean, failing on anything else, as `CSRF_ENABLED` does.

  Verify with new `ConfigLoader.test.ts` cases: development default `debug`, production default `info`, explicit `LOG_LEVEL` wins, `LOG_LLM_CONTENT=yes` is rejected with the message `logging.llmContent (from LOG_LLM_CONTENT)`.
- [x] 1.3 In `config/app.config.json`, remove `logging.level`, add `"llmContent": false`, and add `llm.pricing` with the prices for claude-opus-5-5, claude-sonnet-5-5 and claude-haiku-4-5 from design D7. Update `test/support/testConfig.ts` to match. Verify that `pnpm --filter @investor/api test` passes.
- [x] 1.4 Add `LOG_LLM_CONTENT=` with a debug-only comment to `.env.example`, and update the `LOG_LEVEL` comment there to say it defaults to debug in development and info otherwise. Verify by reading the file.

## 2. Logger: request context, redaction, no console

- [x] 2.1 Create `apps/api/src/logging/RequestContext.ts`, an `AsyncLocalStorage` holding `{ requestId }` with `run` and `get` methods. Verify with a unit test showing that two interleaved `run` calls each see their own ID across `await` boundaries.
- [x] 2.2 Update `LoggerFactory.ts`:
  - add a `mixin` that adds `requestId` from `RequestContext`;
  - widen the redaction paths to the header and field keys in design D3, at the top level and one level deep;
  - add `LoggerFactory.bootstrap()`.

  Verify with `LoggerFactory.test.ts` cases for: the nested `provider.apiKey`, top-level `password` and `token`, the `x-api-key` header, an unlisted field kept as is, and `requestId` present inside `run` and absent outside it.
- [x] 2.3 In `ApiServer.ts`, mount the request-context middleware right after `RequestIdMiddleware`. It wraps `next()` in `RequestContext.run` and sets the Sentry isolation-scope tag `request_id`. Verify that the existing `middlewareOrder.test.ts` still passes, and add an API test asserting that a provider log line written during `POST` to a game turn carries the response's `X-Request-Id`.
- [x] 2.4 Replace both `console.error` calls in `apps/api/src/main.ts`:
  - a `ConfigError` is logged with `fatal` through the bootstrap logger;
  - the `main().catch` handler is logged with `fatal`, the explicit `captureException` is dropped, and the flush is kept.

  Add `no-console: 'error'` for `apps/api/src/**` in `eslint.config.js`. Verify that `pnpm lint` passes and `grep -rn "console\." apps/api/src` returns nothing.

## 3. Sentry integration

- [x] 3.1 In `apps/api/src/instrument.ts`:
  - add `Sentry.pinoIntegration({ log: { levels: ['info','warn','error'] }, error: { levels: ['error','fatal'], handled: true } })`;
  - add a comment explaining that v11 has no `enableLogs` (logs are on by default) and that it must be set if the SDK is pinned to 10.x;
  - add a `beforeSendLog` that drops `/api/health` request lines, and drops `prompt` and `response` attributes when `NODE_ENV=production`.

  Verify with `pnpm --filter @investor/api typecheck`, and a test that the client has an integration named `Pino` when initialised with a dummy DSN.
- [x] 3.2 Add a test asserting that the installed `@sentry/node` major version is ≥10 (it is ≥10.18.0) and that it exports `pinoIntegration`. Keep `"@sentry/node": "^11.4.0"` in `apps/api/package.json`. Verify that the test passes.
- [x] 3.3 Remove duplicate reporting as described in design D5: Express errors are reported only through `logger.error` in `ErrorHandlerMiddleware`. Either configure `setupExpressErrorHandler` not to capture, or drop it if it adds no scope behavior in v11. Verify with a test that uses a Sentry test transport, or a spy on `captureException`, and checks that one unexpected 500 produces exactly one event and that a 400 produces none.

## 4. LLM call logging

- [x] 4.1 Create `apps/api/src/logging/LlmPricing.ts` with `estimate(model, usage)`. It prices each token category at its own rate, rounds to 6 decimals, and returns `null` with a single `warn` per unknown model. Verify with unit tests: 1M input plus 100k output tokens on claude-opus-5-5 costs `6.00`, cache read and write tokens are priced separately, and an unknown model warns only once.
- [x] 4.2 Create `apps/api/src/logging/LlmCallLogger.ts` with the methods `run(meta, fn)`, `instrumentFetch(fetch)` and `refusal(...)`. It uses a per-call `AsyncLocalStorage` frame for attempt counting and emits these events from design D6: `llm.call`, `llm.retry`, `llm.rate_limited`, `llm.overloaded`, `llm.timeout`, `llm.call_failed`. Content fields are included only when `logging.llmContent` is on. Verify with unit tests using `captureLogger`, covering each event's fields and levels.
- [x] 4.3 Wire up `AnthropicThinkingProvider`:
  - build the client with the instrumented fetch;
  - wrap `beta.messages.create` (operation `generate`) and `models.retrieve` (operation `ping`, success logged at `debug`) in `run`;
  - send refusals through `refusal()`;
  - remove the provider's own duplicate failure `warn`/`error` lines, keeping the `toProviderError` mapping.

  Create `LlmCallLogger` in `Container` and pass it in through `ProviderDeps`. Verify that the existing provider tests still pass.
- [x] 4.4 Add an optional `onRetry(reason)` parameter to `generateJsonWithRetry` in `ThinkingProvider.ts`. The Anthropic provider passes one that logs `llm.retry` with `reason: 'invalid_json'`. Verify with a test where the first reply is invalid JSON: it shows one `llm.retry` and two `llm.call` lines.
- [x] 4.5 Add Anthropic provider tests using `stubFetch`:
  - 429 with `retry-after: 2`, then 200: logs `llm.rate_limited` (attempt 1, `retryAfterSeconds: 2`), `llm.retry` (attempt 2), and `llm.call` with `attempts: 2`;
  - 529: logs `llm.overloaded`;
  - every attempt gets 429: one `llm.call_failed` at `error` with `errorType: 'RateLimitError'`, `status: 429` and `attempts = maxRetries + 1`;
  - a timeout: logs `llm.timeout`;
  - 401: logs `llm.call_failed` with `AuthenticationError`, and the API still answers `PROVIDER_UNAVAILABLE`;
  - a fallback-served response: logs `model` and `requestedModel`, priced at the serving model's rates;
  - no prompt text appears unless `llmContent` is on;
  - no `x-api-key` value appears in any log line.

  Verify with `pnpm --filter @investor/api test`.

## 5. Docs and final check

- [x] 5.1 Update `README.md`:
  - add a short Logging section covering levels, redaction, `requestId` and the `LOG_LLM_CONTENT` warning;
  - list the LLM event names and fields;
  - note that Sentry Logs are on and that errors reach Sentry through the logger.

  Verify by reading it.
- [x] 5.2 Run `pnpm typecheck && pnpm lint && pnpm test`. Then run `pnpm dev` with `THINKING_PROVIDER=fake`, make one request, and confirm the pretty logs show `requestId` on the request line and on the service lines. Record the result in the PR description.
