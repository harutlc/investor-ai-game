## Why

Only Anthropic calls get structured `llm.*` events today. The game runs on Ollama for thinking and Laya or Jev for decisions, and those calls leave no trace in the logs or in Sentry when they succeed. Their failures are logged only as ad-hoc `warn` lines, so Sentry gets no error event for them. As a result, latency, token use, retries and failures of the providers actually in use can't be monitored, even though the Anthropic path already shows how.

## What Changes

- Ollama, Jev and Laya calls are logged through the same `LlmCallLogger` as Anthropic calls. This covers both generation and `ping`, and adds no logging code at call sites. Each call emits the same events: `llm.call`, `llm.call_failed`, `llm.retry`, `llm.timeout`, `llm.rate_limited` and `llm.overloaded`. Each line is tagged with `provider` (`ollama`, `jev` or `laya`) and `operation` (`generate`, `decide` or `ping`).
- Success lines carry the provider's usage:
  - Ollama: `prompt_eval_count` and `eval_count`.
  - Jev/Laya: `input_tokens` and `output_tokens`.
  - Both also report `totalTokens`, `latencyMs`, `attempts`, `requestId` and, when the backend sends one, the backend's request ID as `providerRequestId`.
- Cost is estimated for any model listed in `llm.pricing`. Self-hosted providers (Ollama and Laya) log `costUsd: null` and never trigger the "price missing" warning. Jev logs `costUsd: null` with the usual one-time warning until a Jev price is added to the config.
- Final failures of Ollama, Jev or Laya are logged once at `error` as `llm.call_failed`, so they become one Sentry error event, the same as Anthropic. The providers' current `warn` lines for those failures (`Decision request failed`, `Decision provider unreachable`, `Ollama request failed`, `Ollama unreachable`) are removed because they would duplicate it. Two hints are kept at `warn`: the missing-key hint (`TYPESAFE_API_KEY` / `LAYA_API_KEY`) and the missing-model hint (`ollama pull <model>`).
- Decision results now also carry `outputTokens` in `usage`. Today the field is dropped even though the SDK returns it.
- `LOG_LLM_CONTENT=true` adds content for these providers as well:
  - Ollama: the prompt and response text.
  - Jev/Laya: the decision `state`, the questions and the answers.

  It stays off by default.
- The Ollama thinking path keeps its own retry loop and the TypeSafe SDK keeps its own, and both still show up as `llm.retry` events because every HTTP attempt goes through the instrumented `fetch`.

There are no breaking API changes. The behavior of error codes and HTTP statuses (`PROVIDER_UNAVAILABLE` / `PROVIDER_BAD_RESPONSE`) is unchanged.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `llm-call-logging`: extends call logging from Anthropic to every real LLM provider (Ollama, Jev, Laya), with provider-specific usage, request ID and cost rules. This capability is introduced by the unarchived change `add-structured-logging-llm-observability`, so the delta adds requirements rather than modifying ones that aren't in `openspec/specs/` yet.
- `decision-llm`: decision results report `outputTokens`. Backend failures are logged as `llm.call_failed` at `error` instead of ad-hoc `warn` lines; the error codes are unchanged.

## Impact

- **Code:**
  - `apps/api/src/llm/thinking/OllamaThinkingProvider.ts`
  - `apps/api/src/llm/decision/SystemOneDecisionProvider.ts`
  - `apps/api/src/llm/decision/DecisionProvider.ts` (the usage type)
  - `packages/shared/src/decision/DecisionSchemas.ts` (the playground decision response gets an optional `outputTokens`)
  - `apps/api/src/logging/LlmCallLogger.ts`: generic provider request ID; `TimeoutError` counted as a timeout; option to skip pricing.
- **Tests:** the Ollama and SystemOne provider tests gain call-logging cases. The existing cases that expect the removed `warn` lines are updated.
- **Config:** no new environment variables. Jev pricing is optional and goes in `llm.pricing` (keyed by model, e.g. `jev-latest`).
- **Sentry:** more `info` log volume, one line per decision or thinking call. Failed Ollama, Jev and Laya calls now create error events.
- **Ordering:** this builds on `add-structured-logging-llm-observability`, which should be archived first so that `llm-call-logging` exists in `openspec/specs/`.
