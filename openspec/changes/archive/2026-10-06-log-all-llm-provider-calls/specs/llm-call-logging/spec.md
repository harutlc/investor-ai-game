## ADDED Requirements

### Requirement: Every LLM provider call is logged
Calls to Ollama, Jev and Laya SHALL be logged with the same events, levels and shared logging path as Anthropic calls: `llm.call`, `llm.call_failed`, `llm.retry`, `llm.timeout`, `llm.rate_limited` and `llm.overloaded`. This covers text and JSON generation, decisions, and reachability checks.

Each line MUST carry:
- `provider`: `ollama`, `jev` or `laya`;
- `operation`: `generate` for thinking calls, `decide` for decisions, or `ping` for reachability checks;
- `model`: the configured model, or the model the backend reports on success;
- `requestId`.

As for Anthropic:
- successful reachability checks MUST be logged at `debug`;
- all other successful calls MUST be logged at `info`;
- final failures MUST be logged once at `error`.

The fake providers MUST NOT emit `llm.*` events.

#### Scenario: Decision during a game turn
- **WHEN** a game turn makes a decision call to Laya, which answers
- **THEN** one `llm.call` line at `info` shows `provider: "laya"`, `operation: "decide"`, `latencyMs`, `attempts: 1` and the turn's `requestId`

#### Scenario: Ollama thinking call
- **WHEN** a game turn generates investor text through Ollama
- **THEN** one `llm.call` line at `info` shows `provider: "ollama"`, `operation: "generate"`, `maxTokens`, `temperature` and the turn's `requestId`

#### Scenario: Health probe
- **WHEN** the health monitor checks Jev and it answers
- **THEN** one `llm.call` line at `debug` is written with `operation: "ping"`, and nothing is logged at `info`

### Requirement: Provider usage on success
Success lines for non-Anthropic providers SHALL report the usage that each backend returns:
- **Ollama**: `usage.inputTokens` from the prompt evaluation count, `usage.outputTokens` from the generated token count, and `usage.totalTokens`, their sum.
- **Jev and Laya**: `usage.inputTokens` and `usage.outputTokens` from the response usage, and `usage.totalTokens`, their sum.

A count the backend omits MUST be logged as 0. When the backend sends its own request ID, the line MUST include it as `providerRequestId`. For Jev and Laya, this ID comes from the `x-typesafe-request-id` header.

#### Scenario: Jev usage
- **WHEN** Jev answers a decision with 420 input and 12 output tokens and request ID `ts_123`
- **THEN** the `llm.call` line shows `usage.inputTokens: 420`, `usage.outputTokens: 12`, `usage.totalTokens: 432` and `providerRequestId: "ts_123"`

#### Scenario: Ollama usage
- **WHEN** Ollama answers with `prompt_eval_count: 900` and `eval_count: 150`
- **THEN** the `llm.call` line shows `usage.inputTokens: 900`, `usage.outputTokens: 150` and `usage.totalTokens: 1050`

### Requirement: Cost for self-hosted and hosted providers
Self-hosted providers (Ollama and Laya) SHALL log `costUsd: null` and MUST NOT trigger the missing-price warning. Jev SHALL be priced from the same per-model price table as Anthropic, at its input and output rates. When the Jev model has no entry in that table, Jev MUST log `costUsd: null`, together with the usual one-time `warn` naming the model.

#### Scenario: Laya call
- **WHEN** a Laya decision succeeds
- **THEN** `costUsd` is `null` and no missing-price warning is written

#### Scenario: Jev priced
- **WHEN** the price table lists `jev-latest` at $1 input and $5 output per million tokens, and a Jev call uses 1,000,000 input and 100,000 output tokens
- **THEN** `costUsd` is `1.50`

### Requirement: Retries and timeouts for every provider
For Ollama, Jev and Laya, the system SHALL log every HTTP attempt after the first as `llm.retry`, with the attempt number and the reason. This applies whether the retry comes from the provider client or from the application.

When an attempt exceeds the provider's configured timeout, the system SHALL log `llm.timeout` with the attempt number and `timeoutMs`. HTTP 429 MUST be logged as `llm.rate_limited`, and HTTP 529 as `llm.overloaded`, each including any `retry-after` value.

#### Scenario: Laya timeout then recovery
- **WHEN** the first Laya attempt exceeds `timeoutMs` and the second succeeds
- **THEN** an `llm.timeout` line with `attempt: 1` and an `llm.retry` line with `attempt: 2` are written, followed by one `llm.call` line with `attempts: 2`

#### Scenario: Ollama server error then recovery
- **WHEN** Ollama answers the first attempt with 500 and the retry succeeds
- **THEN** an `llm.retry` line with `attempt: 2` and `reason: "status_500"` is written, followed by one `llm.call` line with `attempts: 2`

### Requirement: Provider failures reach Sentry once
A final failure of an Ollama, Jev or Laya call SHALL produce exactly one `llm.call_failed` line at `error`. The line MUST include:
- `errorType`;
- `status`, or `null` when there was no HTTP response;
- `attempts`;
- `latencyMs`;
- `providerRequestId`, when known.

It MUST become exactly one Sentry error event, including when the failure then fails the HTTP request with a 5xx. The provider MUST NOT also write its own `warn` or `error` line for the same failure.

The following MUST still be logged once at `warn`, in addition to the failure line:
- the hint naming the missing or rejected key variable (`TYPESAFE_API_KEY` or `LAYA_API_KEY`);
- the hint to pull a missing Ollama model.

#### Scenario: Laya not running
- **WHEN** laya-serve is unreachable and a game turn asks for a decision
- **THEN** one `llm.call_failed` line at `error` shows `provider: "laya"`, a connection `errorType` and `status: null`; the API answers `PROVIDER_UNAVAILABLE`; and Sentry receives exactly one error event for the request

#### Scenario: Jev key rejected
- **WHEN** Jev answers 401
- **THEN** one `llm.call_failed` line at `error` shows `errorType: "AuthenticationError"` and `status: 401`, and one `warn` line names `TYPESAFE_API_KEY` without containing its value

### Requirement: Reachability check failures are warnings
A failed reachability check (`operation: "ping"`) SHALL be logged as `llm.call_failed` at `warn`, not `error`, for every provider, Anthropic included. It therefore reaches Sentry Logs but creates no Sentry error event. Health probes repeat on a timer, and the health endpoint already reports the outage, so a down backend must not open a new error event on every probe. Failed generation and decision calls MUST still be logged at `error`.

#### Scenario: Laya down during health probes
- **WHEN** laya-serve is unreachable and `/api/health` probes the decision provider
- **THEN** an `llm.call_failed` line at `warn` with `operation: "ping"` is written and no Sentry error event is created

#### Scenario: Decision failure still an error
- **WHEN** laya-serve is unreachable and a game turn asks for a decision
- **THEN** the `llm.call_failed` line for that decision is written at `error`

### Requirement: Content logging for every provider
When `LOG_LLM_CONTENT` is `true`, the following content SHALL be added:
- Ollama lines: the system prompt, the messages and, on success, the response text, as for Anthropic.
- Jev and Laya lines: the decision `state` and `questions` and, on success, the `answers`.

When `LOG_LLM_CONTENT` is unset or `false`, none of this content MUST appear in any provider's log lines.

#### Scenario: Decision content off by default
- **WHEN** `LOG_LLM_CONTENT` is unset and a Laya decision succeeds
- **THEN** the `llm.call` line contains no `state`, `questions` or `answers`

#### Scenario: Decision content enabled
- **WHEN** `LOG_LLM_CONTENT=true` and a Laya decision succeeds
- **THEN** the `llm.call` line contains the request's `state` and `questions` and the returned `answers`
