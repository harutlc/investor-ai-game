# llm-call-logging Specification

## Purpose
Gives every Anthropic API call a structured, correlated log record with usage, cost and latency. Rate limiting, overload, retries, timeouts and failures are logged as separate events, so LLM spend and reliability can be monitored from the application logs and from Sentry.

## Requirements

### Requirement: Every Anthropic call is logged
The system SHALL log every Anthropic API call that the application makes, whether it is a generation or a reachability check. Logging MUST happen in one shared place, so that no call site has to log on its own and no call goes unlogged. The logging MUST NOT change the call's result, errors or timing in any way the caller can see.

#### Scenario: New call site is covered
- **WHEN** a feature generates text through the Anthropic provider without any logging code of its own
- **THEN** that call still produces an `llm.call` log line

### Requirement: Success record
A successful generation call SHALL produce exactly one `info` log line with the event name `llm.call`. The line MUST contain:
- `provider` (`anthropic`);
- `model`: the model that served the response, and `requestedModel` when it differs (for example after a fallback);
- request parameters: `maxTokens`, `temperature` (`null` when not sent), `effort` and whether fallbacks are on;
- `usage`: `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens` and `totalTokens` (the sum of all four), taken from the response's usage field;
- `costUsd`: the estimated cost (see "Cost estimation");
- `latencyMs`: wall-clock time of the whole call, including retries;
- `attempts`: the number of HTTP attempts it took;
- `stopReason`;
- `anthropicRequestId`;
- `requestId`, which ties the call to the HTTP request.

#### Scenario: Successful turn
- **WHEN** a game turn calls Anthropic, which answers with 1,200 input and 300 output tokens
- **THEN** one `llm.call` line at `info` shows `usage.inputTokens: 1200`, `usage.outputTokens: 300`, `usage.totalTokens: 1500`, a `costUsd` above 0, a `latencyMs`, `attempts: 1` and the turn's `requestId`

#### Scenario: Served by a fallback model
- **WHEN** the requested model declines and the server-side fallback model answers
- **THEN** `model` is the fallback model, `requestedModel` is the configured model, and `costUsd` is priced at the fallback model's rates

### Requirement: Prompt and response content excluded by default
LLM log lines SHALL NOT contain the system prompt, the messages or the response text unless `LOG_LLM_CONTENT` is `true`. When it is `true`, the `llm.call` line and the failure line MUST also include the system prompt, the messages and (on success) the response text. Content logging MUST be off by default in every environment.

#### Scenario: Default
- **WHEN** `LOG_LLM_CONTENT` is unset and a call succeeds
- **THEN** the `llm.call` line contains no prompt or response text

#### Scenario: Debugging enabled
- **WHEN** `LOG_LLM_CONTENT=true` and a call succeeds
- **THEN** the `llm.call` line contains `prompt.system`, `prompt.messages` and `response.text`

### Requirement: Cost estimation
The system SHALL estimate each call's cost in USD from a per-model price table in the configuration. The table gives prices per million tokens for input, output, cache reads and cache writes. Each token category MUST be priced at its own rate. When the serving model has no entry in the table, `costUsd` MUST be `null` and a `warn` line naming the model MUST be written once per model per process. The call itself MUST NOT fail.

#### Scenario: Priced model
- **WHEN** the price table lists `claude-opus-5-5` at $4 input and $20 output per million tokens, and a call uses 1,000,000 input and 100,000 output tokens on it with no cache use
- **THEN** `costUsd` is `6.00`

#### Scenario: Unpriced model
- **WHEN** a call is served by a model missing from the price table
- **THEN** `costUsd` is `null` and a single `warn` line names the model

### Requirement: Rate-limit and overload events
When Anthropic answers an attempt with HTTP 429, the system SHALL log an `llm.rate_limited` event at `warn`. When it answers with HTTP 529 (overloaded), the system SHALL log an `llm.overloaded` event at `warn`. Each event MUST include the attempt number, the `retry-after` value in seconds and in milliseconds when the response sent one (`null` otherwise), the Anthropic request ID, the model and `requestId`. These events MUST be logged for every attempt that gets such a response, including attempts the SDK later retries successfully.

#### Scenario: Rate limited then recovered
- **WHEN** the first attempt gets 429 with `retry-after: 2` and the retry succeeds
- **THEN** one `llm.rate_limited` line shows `attempt: 1` and `retryAfterSeconds: 2`, one `llm.retry` line follows, and one `llm.call` line at `info` shows `attempts: 2`

#### Scenario: Overloaded
- **WHEN** an attempt gets HTTP 529
- **THEN** an `llm.overloaded` line is written at `warn` with the attempt number

### Requirement: Retry and timeout events
Before each retry, the system SHALL log an `llm.retry` event at `warn`. This applies both to transport retries (after 408, 409, 429, 5xx or a connection error) and to the application's retry after invalid JSON output. The event MUST include `attempt` (the number of the attempt about to start), `reason` and `requestId`.

When an attempt times out, the system SHALL log an `llm.timeout` event at `warn` with the attempt number and the configured timeout in milliseconds.

#### Scenario: Timeout then retry
- **WHEN** attempt 1 times out after `timeoutMs` and attempt 2 is started
- **THEN** an `llm.timeout` line with `attempt: 1` is written, followed by an `llm.retry` line with `attempt: 2`

#### Scenario: Invalid JSON retry
- **WHEN** a JSON generation call gets output that fails the schema and the provider asks again
- **THEN** an `llm.retry` line with `reason: "invalid_json"` is written, and each of the two calls produces its own `llm.call` line

### Requirement: Failed call event
A call that finally fails, after all retries, SHALL produce exactly one `llm.call_failed` line at `error`. The line MUST include:
- `errorType`: the SDK error class name, such as `RateLimitError`, `APIConnectionTimeoutError` or `AuthenticationError`;
- `status`, or `null` when there was no HTTP response;
- `attempts`, `latencyMs`, `model`, `anthropicRequestId` when known, and `requestId`;
- the error itself.

Because the line is at `error`, it MUST reach Sentry as an error event (see error-monitoring). A refusal (`stop_reason: "refusal"`) MUST also be logged as `llm.call_failed`, with `errorType: "Refusal"` and the refusal category. Successful calls MUST NOT be logged at `error`, and failed calls MUST NOT be logged as `llm.call` at `info`.

#### Scenario: Retries exhausted
- **WHEN** every attempt gets 429
- **THEN** one `llm.call_failed` line at `error` shows `errorType: "RateLimitError"`, `status: 429` and `attempts` equal to the configured retries plus one, and a Sentry error event is created for it

#### Scenario: Bad credentials
- **WHEN** Anthropic answers 401
- **THEN** one `llm.call_failed` line at `error` shows `errorType: "AuthenticationError"` and `status: 401`, and the API responds with `PROVIDER_UNAVAILABLE` as before

### Requirement: Logs flow through the application logger
All LLM log lines SHALL be written through the same application logger as all other log lines. They therefore get the same redaction, level filtering, request ID and Sentry forwarding. LLM log lines MUST NOT include the API key or any authentication header.

#### Scenario: LLM line reaches Sentry Logs
- **WHEN** an `llm.call` line is written at `info` with a DSN configured
- **THEN** it arrives in Sentry Logs with its usage, cost and `requestId` fields

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
