## Purpose

Gives developers HTTP endpoints for trying the active thinking and decision providers by hand: checking prompts, question wording, latency and provider switching without a UI. The endpoints are never available in production.

## ADDED Requirements

### Requirement: Availability
The playground endpoints SHALL be mounted under `/api/dev` only when `dev.playground` is `true` in the configuration and `NODE_ENV` is not `production`. Otherwise every `/api/dev/*` path MUST respond 404 `NOT_FOUND`. The endpoints SHALL use the same session, CSRF, content-type, body-size and rate-limit protections as every other mutating endpoint.

#### Scenario: Disabled in production
- **WHEN** `NODE_ENV=production` and `dev.playground` is `true`
- **THEN** `POST /api/dev/thinking/text` responds 404 `NOT_FOUND`

#### Scenario: Disabled by config
- **WHEN** `dev.playground` is `false`
- **THEN** `POST /api/dev/decision` responds 404 `NOT_FOUND`

#### Scenario: CSRF still required
- **WHEN** the playground is enabled and a client posts to `/api/dev/thinking/text` without a CSRF token
- **THEN** the response is 403 `CSRF_INVALID`

### Requirement: Thinking text endpoint
`POST /api/dev/thinking/text` SHALL accept `{ system?: string, messages: { role: "user" | "assistant", content: string }[] }`, with 1–20 messages, each 1–4000 characters, and a system prompt of at most 8000 characters. It SHALL return `{ provider, model, text, latencyMs }` from the active thinking provider.

#### Scenario: Text reply
- **WHEN** a client posts `{ "messages": [{ "role": "user", "content": "Pitch me in one line" }] }` with a valid CSRF token
- **THEN** the response is 200 with a non-empty `text` and the active provider's name

#### Scenario: Invalid body
- **WHEN** a client posts an empty `messages` array
- **THEN** the response is 400 `VALIDATION_ERROR`

### Requirement: Thinking JSON endpoint
`POST /api/dev/thinking/json` SHALL accept the same fields plus `schema`, a JSON Schema object describing the expected output. It SHALL return `{ provider, model, data, latencyMs }`, where `data` conforms to `schema`. A `schema` that cannot be interpreted as a JSON Schema MUST be rejected with 400 `VALIDATION_ERROR`.

#### Scenario: Structured reply
- **WHEN** a client posts a prompt and the schema `{ "type": "object", "properties": { "options": { "type": "array", "items": { "type": "string" } } }, "required": ["options"] }`
- **THEN** the response `data` is an object whose `options` is an array of strings

### Requirement: Decision endpoint
`POST /api/dev/decision` SHALL accept `{ state, questions }` using the decision question types and limits. It SHALL return `{ provider, model, answers, usage, latencyMs }` from the active decision provider.

#### Scenario: Decision answers
- **WHEN** a client posts a state and a choice question `reaction` with options `accept`, `counter`, `reject`
- **THEN** the response contains `answers.reaction.value` equal to one of those options, plus its probabilities and confidence

### Requirement: Provider errors surface in the envelope
When the active provider fails, the playground endpoints SHALL respond using the standard error envelope with the provider error code (`PROVIDER_UNAVAILABLE` 503 or `PROVIDER_BAD_RESPONSE` 502). The response MUST NOT include secrets or raw backend responses.

#### Scenario: Provider down
- **WHEN** the active thinking provider is unreachable and a client calls `/api/dev/thinking/text`
- **THEN** the response is 503 with `error.code = "PROVIDER_UNAVAILABLE"`
