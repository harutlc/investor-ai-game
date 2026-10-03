## Purpose

Gives the application one way to ask a general-purpose "thinking" LLM for free text or for JSON that matches a declared schema. The concrete provider (local Ollama, hosted Anthropic, or a fake) is chosen by configuration, not by code.

## ADDED Requirements

### Requirement: Provider selection by configuration
The system SHALL use exactly one active thinking provider, named by `llm.thinking.provider` in the config file. Supported names are `ollama`, `anthropic` and `fake`. The `THINKING_PROVIDER` environment variable MUST override the file value. Switching providers MUST NOT require code changes.

#### Scenario: File selects Ollama
- **WHEN** the config file sets `llm.thinking.provider` to `ollama` and `THINKING_PROVIDER` is unset
- **THEN** thinking requests are served by the Ollama provider

#### Scenario: Environment override
- **WHEN** the config file selects `ollama` and `THINKING_PROVIDER=anthropic`
- **THEN** thinking requests are served by the Anthropic provider

#### Scenario: Unknown provider
- **WHEN** the active thinking provider is `gemini`
- **THEN** startup fails with a configuration error naming `llm.thinking.provider` and listing the supported names

### Requirement: Per-provider settings
Each thinking provider SHALL have its own settings block under `llm.thinking.providers.<name>`:
- **ollama**: `baseUrl`, `model`, `temperature`, `maxTokens`
- **anthropic**: `model`, `maxTokens`, `effort`, `fallbacks`

Every provider also has `timeoutMs` and `maxRetries`. `OLLAMA_BASE_URL` MUST override the Ollama base URL. Settings for inactive providers MUST still be schema-valid, but their secrets are not required.

#### Scenario: Ollama base URL override
- **WHEN** `OLLAMA_BASE_URL=http://gpu-box:11434` is set
- **THEN** Ollama requests go to `http://gpu-box:11434`

### Requirement: Secrets and fail-fast checks
API keys SHALL come only from the environment (`ANTHROPIC_API_KEY`). When the active thinking provider needs a key and the key is missing, startup MUST fail with a message naming the variable. A missing key for an inactive provider MUST NOT fail startup. Key values MUST NOT appear in error messages, logs or HTTP responses.

#### Scenario: Missing Anthropic key
- **WHEN** the active thinking provider is `anthropic` and `ANTHROPIC_API_KEY` is unset
- **THEN** startup fails with a message naming `ANTHROPIC_API_KEY`

#### Scenario: Key for an inactive provider
- **WHEN** the active thinking provider is `ollama` and `ANTHROPIC_API_KEY` is unset
- **THEN** startup succeeds

### Requirement: Fake provider not allowed in production
The `fake` thinking provider SHALL be rejected by configuration validation when `NODE_ENV=production`.

#### Scenario: Fake in production
- **WHEN** `NODE_ENV=production` and the active thinking provider is `fake`
- **THEN** startup fails with a configuration error

### Requirement: Text generation
The thinking provider SHALL generate a text reply from a system prompt and an ordered list of `user`/`assistant` messages. It returns the reply text together with the provider name, the model used and the latency in milliseconds. Leading and trailing whitespace MUST be trimmed. An empty reply MUST be treated as a bad response.

#### Scenario: Reply returned
- **WHEN** the application asks the active provider to reply to the message "Hello" with a system prompt
- **THEN** it receives a non-empty text, the provider name, the model and a latency value

### Requirement: Schema-validated JSON generation
The thinking provider SHALL generate JSON that conforms to a schema supplied by the caller. It returns the parsed, validated value, never raw text. The provider MUST constrain the model to the schema when the backend supports it. The provider MUST tolerate JSON wrapped in Markdown code fences. When the output is not valid JSON or does not match the schema, the provider MUST retry once and tell the model what was wrong. If the retry also fails, it MUST fail with a bad-response error.

#### Scenario: Valid JSON
- **WHEN** the caller asks for an object `{ "options": string[] }` and the model returns matching JSON
- **THEN** the caller receives the typed object

#### Scenario: Fenced JSON
- **WHEN** the model wraps its JSON in a ```` ```json ```` fence
- **THEN** the fence is removed and the JSON is parsed and validated

#### Scenario: Invalid then valid
- **WHEN** the first reply fails schema validation and the retry returns valid JSON
- **THEN** the caller receives the valid object from the retry

#### Scenario: Invalid twice
- **WHEN** both the first reply and the retry fail validation
- **THEN** the call fails with error code `PROVIDER_BAD_RESPONSE`

### Requirement: Refusals
When a hosted model declines a request for safety reasons, and no configured fallback produces an answer, the provider SHALL fail with `PROVIDER_BAD_RESPONSE` instead of returning partial or empty content.

#### Scenario: Refused request
- **WHEN** the Anthropic provider receives a refusal stop reason
- **THEN** the call fails with error code `PROVIDER_BAD_RESPONSE`

### Requirement: Failure mapping
Connection failures, timeouts, rate limiting and server-side (5xx) errors from the thinking backend SHALL surface as `PROVIDER_UNAVAILABLE`, which maps to HTTP 503 in the error envelope. Invalid output and refusals SHALL surface as `PROVIDER_BAD_RESPONSE`, which maps to HTTP 502. Configured timeouts and retry limits MUST be enforced.

#### Scenario: Backend down
- **WHEN** the Ollama server is not running and a thinking request is made
- **THEN** the call fails with `PROVIDER_UNAVAILABLE`

#### Scenario: Timeout
- **WHEN** the backend does not answer within `timeoutMs` on every attempt
- **THEN** the call fails with `PROVIDER_UNAVAILABLE`

### Requirement: Reachability check
The thinking provider SHALL expose a reachability check that confirms the backend answers and the configured model is available, without generating any text. The check MUST time out within 3 seconds.

#### Scenario: Ollama model not pulled
- **WHEN** Ollama is running but the configured model is not in its local model list
- **THEN** the reachability check reports an error
