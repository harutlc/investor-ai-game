## Context

`LlmCallLogger` (from `add-structured-logging-llm-observability`) logs Anthropic calls through two hooks:
- `run(meta, call, describe)`: one line per call, either `llm.call` or `llm.call_failed`;
- `instrumentFetch(fetch)`: one hook per HTTP attempt, emitting `llm.retry`, `llm.timeout`, `llm.rate_limited` and `llm.overloaded`.

`Container` already passes `llmCalls` to both provider factories through `ProviderDeps`. Neither non-Anthropic provider uses it yet.

The other two providers work as follows:

- **`OllamaThinkingProvider`**
  - Uses the `ollama` client with an injected `fetch`. That `fetch` is wrapped in `timedFetch`, which adds `AbortSignal.timeout(timeoutMs)`.
  - Retries happen in the application: `withRetry` wraps `client.chat` / `client.list`.
  - JSON output that fails validation is retried through `generateJsonWithRetry`.
  - Responses carry `prompt_eval_count`, `eval_count` and `done_reason`, but no request ID.
- **`SystemOneDecisionProvider`** (Jev and Laya)
  - Uses `TypeSafeClient` 0.6 with an injected `fetch`.
  - The SDK calls `fetch` once per attempt. It retries 408, 429 and 5xx responses and connection errors, honoring `retry-after-ms` / `retry-after`.
  - Each attempt is bounded by an `AbortController`, which aborts `init.signal` on timeout.
  - The request ID comes from the `x-typesafe-request-id` header (`APIError.requestId`).
  - Usage is `{ input_tokens, output_tokens }`.
  - Answer mapping (`DecisionAnswerMapper`) runs after the HTTP call and can throw `PROVIDER_BAD_RESPONSE`.
  - Laya's `ping` is a plain `fetch` to `/health` with `AbortSignal.timeout(3000)`.

## Goals / Non-Goals

**Goals:**
- The same event schema for every real provider, so one Sentry query (`message:llm.call`) covers all LLM traffic.
- No logging at call sites.
- Exactly one Sentry error event per failed generation or decision.

**Non-Goals:**
- Logging the fake providers.
- Prices for Laya or Ollama.
- Changing retry or timeout behavior.
- Replacing `decision_logs`. The database table stays the per-game audit record; the `llm.*` lines are for operations.
- Renaming Anthropic's `anthropicRequestId`.

## Decisions

### D1. Reuse `LlmCallLogger` with a generalized metadata shape
- `LlmCallMeta.provider` widens to `'anthropic' | 'ollama' | 'jev' | 'laya'`.
- `operation` gains `'decide'`.
- `LlmResponseInfo` gains `providerRequestId`.
- `failed()` reads the request ID from `error.requestID` (Anthropic) or `error.requestId` (TypeSafe).
- On rate-limit and overload lines, `instrumentFetch` reads `request-id` or `x-typesafe-request-id`.

Anthropic lines keep `anthropicRequestId`. All other providers log `providerRequestId`.

*Alternatives considered:*
- A separate `DecisionCallLogger`. Rejected because it would duplicate retry and timeout handling, and decision events would diverge from the rest.
- Renaming the Anthropic field to `providerRequestId`. Rejected because it breaks the schema just shipped. It can be done later as its own change.

### D2. Pricing is opt-in per call
`LlmCallMeta` gains `priced: boolean`. Ollama and Laya pass `false`: `costUsd` is `null` and `LlmPricing.estimate` is never called, so no missing-price warning is written. Jev and Anthropic pass `true`. Jev usage maps onto `LlmUsage` with zero cache tokens, so the existing estimator works unchanged.

Jev answers a `jev-latest` request with the version it resolved (seen in the dev run: `jev-1.13.0`), so cost is looked up by the serving model first, then by the configured model. Anthropic never falls back: there a different serving model is a real fallback model and is priced at its own rates (or not at all).

*Alternative considered:* putting zero prices for local models in config. Rejected because `0` would read as "free hosted call", and the model name changes with every `OLLAMA_MODEL`.

### D3. Where `run` wraps
- **Ollama:** each `chat()` is one `run`, with operation `generate`. The invalid-JSON retry therefore yields two `llm.call` lines plus `llm.retry` `reason: "invalid_json"`, through the existing `onRetry` hook, matching Anthropic.
- **Ollama `ping`:** wraps `client.list()` and the model-presence check. A missing model fails the ping. Its `ollama pull` hint stays a separate `warn`.
- **SystemOne `decide`:** one `run` around `client.systemOne(...)` and `DecisionAnswerMapper.map`. A bad label therefore counts as a failed call, not a success.
- **SystemOne `ping`:** wraps `models.list` for Jev and the `/health` fetch for Laya.
- **`decideMany`:** produces one `llm.call` per request. The calls run concurrently, but each `run` has its own `AsyncLocalStorage` frame, so attempt counts don't mix.

### D4. Instrumented `fetch` placement and timeout detection
- **Ollama:** the instrumented `fetch` wraps `timedFetch`, so it sees the per-attempt timeout. That error is a `DOMException` named `TimeoutError`, raised from a signal created inside `timedFetch`. The outer `init.signal` is not aborted, so `LlmCallLogger.isTimeout` also treats the name `TimeoutError` as a timeout.
- **SystemOne:** the instrumented `fetch` wraps `deps.fetch` before it is handed to `TypeSafeClient`, and is also used for the Laya `/health` request. The SDK's own controller aborts `init.signal`, which the existing `aborted` check detects.

### D5. One failure line, then the provider maps the error
Inside `run`, providers no longer log failures. `toProviderError` keeps only:
- the error mapping;
- the key hint (`warn`, no value) on 401/403;
- the `ollama pull` hint.

The `error`-level 401 line in `SystemOneDecisionProvider` becomes `warn`, since `llm.call_failed` is now the error. `ReportedErrors.mark` already runs inside `run`. `ErrorHandlerMiddleware` therefore doesn't log the mapped `ProviderUnavailableError` at `error` again: `has()` walks the `cause` chain, and the mapped error's cause is the marked SDK error. That gives one Sentry event per failed request.

### D6. Ping failures log at `warn` for all providers
Inside `failed()`, `operation === 'ping'` selects `warn` instead of `error`, and the error is not marked as reported. That doesn't matter, because ping errors never reach the HTTP error handler. This also changes Anthropic: a missing key used to create an error event on every health probe window.

*Alternative considered:* rate-limiting ping errors to one per transition from ok to error. Rejected for now; it needs state in the health monitor, and the health endpoint already reports the status.

### D7. Content and usage fields
`describe()` for SystemOne returns `{ model, usage, providerRequestId, content: { answers } }`. `LlmCallMeta.prompt` gains a decision variant, `{ state, questions }`. `content()` emits whichever variant is present, and only when `logContent` is on. In production, `beforeSendLog` already strips the `prompt` and `response` attributes. The decision payload is logged under those same keys (`prompt.state`, `prompt.questions`, `response.answers`), so it gets the same stripping.

`DecisionResult.usage` gains `outputTokens`. The playground schema gets it as an optional field, so web clients keep working.

## Risks / Trade-offs

- **[Risk] Sentry Logs volume grows.** Each game turn adds one or more decision `info` lines and one Ollama line. → It's bounded by turns. Health-probe successes stay at `debug`, which isn't forwarded.
- **[Risk] A TypeSafe timeout while the response body is still being read is missed.** That timeout happens after `fetch` has returned, so the per-attempt hook doesn't see it. → The final `llm.call_failed` still shows `errorType: "APITimeoutError"`. Only the intermediate `llm.timeout` line is missing in this rare case.
- **[Risk] The Ollama retry reason for a connection error is `connection`, not the error class.** → This matches the Anthropic behavior, and the final failure line carries `errorType`.
- **[Trade-off] Ping failures are no longer Sentry issues.** An outage is visible in `/api/health` and in Sentry Logs at `warn`. Alerting on it needs a log-based alert.

## Migration Plan

1. Archive `add-structured-logging-llm-observability` first, so that `llm-call-logging` exists in `openspec/specs/` before this change's delta is archived.
2. Deploy as usual. No config or data migration is needed.
3. Optional: add `jev-latest` prices to `llm.pricing` to get Jev cost estimates.
4. Rollback: redeploy the previous tag. Nothing is persisted differently.

## Open Questions

- What are Jev's per-token prices? Until they're known, the config ships without them, and `costUsd` is `null` with a single warning.
