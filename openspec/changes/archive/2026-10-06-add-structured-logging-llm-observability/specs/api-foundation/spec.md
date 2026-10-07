## MODIFIED Requirements

### Requirement: Request ID
The system SHALL give every request a request ID, return it in the `X-Request-Id` response header and include it in every log line and error response for that request. A client-supplied `X-Request-Id` MUST be accepted only if it is a well-formed UUID; otherwise the server MUST generate a new one.

"Every log line for that request" includes lines written while the request is being handled by code that does not hold a request-scoped logger, such as LLM providers, the investor brain, repositories and asynchronous work started by the request. Every such line MUST carry the request ID in a `requestId` field. Log lines written outside any request, such as startup, shutdown and health probes run on a timer, MUST NOT carry a `requestId`.

#### Scenario: Generated ID
- **WHEN** a request arrives without `X-Request-Id`
- **THEN** the response carries a newly generated UUID in `X-Request-Id`

#### Scenario: Malicious ID
- **WHEN** a request arrives with `X-Request-Id: <script>`
- **THEN** the server ignores it and returns a generated UUID instead

#### Scenario: Provider log line carries the request ID
- **WHEN** a request with `X-Request-Id: 3f0e…` triggers an LLM call and the provider writes a log line
- **THEN** that log line has `requestId` equal to `3f0e…`

#### Scenario: Concurrent requests stay separate
- **WHEN** two requests are handled at the same time and both trigger provider log lines
- **THEN** each provider log line carries the ID of the request that caused it, never the other request's ID

#### Scenario: Startup line has no request ID
- **WHEN** the API logs that it is listening
- **THEN** that line has no `requestId` field

### Requirement: Structured logging with redaction
The system SHALL write structured JSON logs (pretty-printed in development) for every request, recording at least the method, path, status, duration and request ID. Every module MUST log through the single application logger, and the API MUST NOT write log output through `console`.

The log level SHALL come from `LOG_LEVEL` (or `logging.level` in the config file) when set. When neither is set, the level MUST be `debug` when `NODE_ENV` is `development` and `info` otherwise.

Logs MUST redact the values of:
- the `Cookie`, `Set-Cookie`, `Authorization`, `X-CSRF-Token` and `X-Api-Key` headers;
- any field named `password`, `token`, `accessToken`, `refreshToken`, `secret`, `apiKey`, `api_key` or `authorization`, whether it is a top-level field of a log line or one level inside an object in a log line.

A redacted value MUST appear as `[Redacted]`. Fields not on this list MUST be left as they are.

#### Scenario: Cookie redacted
- **WHEN** a request carrying a session cookie is logged
- **THEN** the cookie value is shown as `[Redacted]` in the log line

#### Scenario: Nested secret redacted
- **WHEN** code logs `{ provider: { apiKey: "sk-ant-…" } }`
- **THEN** the log line shows `provider.apiKey` as `[Redacted]` and the rest of `provider` unchanged

#### Scenario: Development default level
- **WHEN** the API starts with `NODE_ENV=development` and no `LOG_LEVEL` in the environment or the config file
- **THEN** `debug` lines are written

#### Scenario: Production default level
- **WHEN** the API starts with `NODE_ENV=production` and no `LOG_LEVEL` in the environment or the config file
- **THEN** `debug` lines are not written and `info` lines are

#### Scenario: Explicit level wins
- **WHEN** the API starts with `NODE_ENV=development` and `LOG_LEVEL=warn`
- **THEN** `info` and `debug` lines are not written

#### Scenario: Fatal startup error goes through the logger
- **WHEN** startup fails because the configuration is invalid
- **THEN** the message naming the invalid keys is written as a structured log line at `fatal` level, and the process exits with a non-zero code
