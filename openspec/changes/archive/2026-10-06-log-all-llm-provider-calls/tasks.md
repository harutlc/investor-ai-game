## 0. Prerequisite

- [x] 0.1 Archive `add-structured-logging-llm-observability` with `/opsx:archive`, so `llm-call-logging` exists in `openspec/specs/`. Verify `openspec list --specs` shows `llm-call-logging`, then run `openspec validate log-all-llm-provider-calls --strict`.

## 1. LlmCallLogger generalization

- [x] 1.1 Generalize the types in `apps/api/src/logging/LlmCallLogger.ts` (design D1, D2, D7):
  - widen `LlmCallMeta.provider` to `anthropic | ollama | jev | laya`;
  - add `'decide'` to `operation`;
  - add `priced: boolean`;
  - add a decision `prompt` variant `{ state, questions }`;
  - add `providerRequestId` and a `content` (answers) field to `LlmResponseInfo`.

  Anthropic passes `priced: true`. Verify with `pnpm --filter @investor/api typecheck`, and confirm the existing `LlmCallLogger` and Anthropic tests still pass.
- [x] 1.2 Unpriced calls:
  - when `priced` is false, log `costUsd: null` and never call `LlmPricing.estimate`;
  - `failed()` reads `error.requestId` (TypeSafe) as well as `error.requestID`, and logs it as `providerRequestId` for non-Anthropic providers;
  - `instrumentFetch` reads `x-typesafe-request-id` on rate-limit and overload lines.

  Verify with new `LlmCallLogger.test.ts` cases: an unpriced call logs `costUsd: null` with no `llm.price_missing` line; a TypeSafe-style error's request ID appears as `providerRequestId`.
- [x] 1.3 Treat errors named `TimeoutError` as timeouts in `isTimeout`, and log `llm.call_failed` at `warn` without `ReportedErrors.mark` when `operation === 'ping'` (design D4, D6). Verify with unit tests: a `TimeoutError` thrown by the wrapped fetch logs `llm.timeout`, a failed ping logs at `warn`, and a failed `generate` still logs at `error`.

## 2. Decision providers (Jev, Laya)

- [x] 2.1 Add `outputTokens` to `DecisionResult.usage` in `DecisionProvider.ts`. In `packages/shared/src/decision/DecisionSchemas.ts`, add an optional `outputTokens` to `usage`. Map `output_tokens`, using 0 when it's missing. Update the fake provider to report it. Verify that the Jev test asserts `usage: { inputTokens: 296, outputTokens: 20 }` and that `pnpm typecheck` passes for every package.
- [x] 2.2 Wire `SystemOneDecisionProvider` to the call logger (design D3, D5):
  - build `TypeSafeClient` with `calls.instrumentFetch(deps.fetch ?? globalThis.fetch)`, and use the same instrumented fetch for the Laya `/health` ping;
  - wrap `client.systemOne` together with the answer mapping in `calls.run`, using `operation: 'decide'`, `priced: name === 'jev'` and the decision prompt;
  - wrap `ping` in `calls.run`, using `operation: 'ping'`;
  - remove the `Decision request failed`, `Decision provider unreachable` and `malformed response` log lines, and downgrade the 401/403 key hint to `warn`.

  If `deps.llmCalls` is absent, fall back to a local `LlmCallLogger`, as the Anthropic provider does. Verify that the existing SystemOne tests pass, with the 401 test updated to expect the hint at `warn` plus `llm.call_failed` at `error`.
- [x] 2.3 Add SystemOne call-logging tests using `stubFetch`:
  - **Jev success:** one `llm.call` at `info` with `provider: "jev"`, `operation: "decide"`, `usage` 296/20/316, `providerRequestId` from `x-typesafe-request-id`, and a `costUsd` once `jev-latest` is priced in the test config;
  - **Laya success:** `costUsd: null` and no price warning;
  - **503 then 200:** `llm.retry` with `attempt: 2` and `llm.call` with `attempts: 2`;
  - **429 with `retry-after`:** `llm.rate_limited` with `retryAfterSeconds`;
  - **Refused connection:** a single `llm.call_failed` at `error` with `status: null`, and no other `warn` or `error` line for the failure;
  - **Unknown label:** `llm.call_failed` with `errorType: "ProviderBadResponseError"`;
  - **Laya ping unreachable:** `llm.call_failed` at `warn`;
  - **Content:** no `state`, `questions` or `answers` unless `logContent` is on, and with it on, all three are present;
  - **Key:** no key value appears in any line.

  Verify with `pnpm --filter @investor/api test`.

## 3. Ollama thinking provider

- [x] 3.1 Wire `OllamaThinkingProvider` to the call logger (design D3–D5):
  - wrap `timedFetch` with `calls.instrumentFetch` before passing it to `new Ollama(...)`;
  - wrap each `chat()` in `calls.run`, using `operation: 'generate'`, `priced: false`, `maxTokens`, `temperature` and the prompt. `describe` maps `prompt_eval_count` and `eval_count` to usage, `done_reason` to `stopReason`, and adds the response text;
  - pass `onRetry` to `generateJsonWithRetry`, logging `llm.retry` with `reason: "invalid_json"`;
  - wrap `ping` in `calls.run`, using `operation: 'ping'`;
  - remove the `Ollama request failed` and `Ollama unreachable` lines, keeping the `ollama pull` hint.

  Verify that the existing Ollama tests pass, updated where they asserted the removed lines.
- [x] 3.2 Add Ollama call-logging tests:
  - **Success:** `llm.call` with usage 900/150/1050, `costUsd: null` and `stopReason`;
  - **500 then 200:** `llm.retry` with `reason: "status_500"`, then `attempts: 2`;
  - **Timeout:** `llm.timeout` with `attempt: 1`;
  - **Invalid JSON then valid:** one `llm.retry` with `invalid_json` and two `llm.call` lines;
  - **Refused connection after retries:** one `llm.call_failed` at `error`;
  - **Missing model on ping:** `llm.call_failed` at `warn` plus the `ollama pull` hint;
  - **Content:** prompt and response text appear only when `logContent` is on.

  Verify with `pnpm --filter @investor/api test`.

## 4. End-to-end and docs

- [x] 4.1 Add an API test, using a test app with a stubbed Laya fetch, that makes Laya unreachable during a game turn. Assert:
  - the response is 503 `PROVIDER_UNAVAILABLE`;
  - exactly one `llm.call_failed` line at `error` carries the response's `X-Request-Id`;
  - with the Sentry capture transport from `test/monitoring/sentry.test.ts`, exactly one error event is sent.

  Verify with `pnpm --filter @investor/api test`.
- [x] 4.2 Update the README Logging section: list the providers that log, the `operation` values, `providerRequestId`, `costUsd: null` for Ollama and Laya, ping failures at `warn`, and how to price Jev in `llm.pricing`. Verify by reading the section.
- [x] 4.3 Run `pnpm typecheck && pnpm lint && pnpm test`. Then run `pnpm dev` with Ollama and Laya, play one turn, and confirm that `llm.call` lines for `ollama` and `laya` appear in the console and in Sentry Logs with the turn's `requestId`.
  - Done: all checks pass. laya-serve isn't installed locally, so the manual run used Ollama and Jev (the `.env` default); Laya is covered by the unit and API tests. All 11 `llm.call` lines (Anthropic, Ollama, Jev) reached Sentry Logs, each with its turn's `requestId`. The run showed that Jev reports the resolved version (`jev-1.13.0`), so pricing falls back to the configured model name for non-Anthropic providers (design D2).
