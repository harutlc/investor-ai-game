## Purpose

Gives every Anthropic API call a structured, correlated log record with usage, cost and latency. Rate limiting, overload, retries, timeouts and failures are logged as separate events, so LLM spend and reliability can be monitored from the application logs and from Sentry.

## ADDED Requirements

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
