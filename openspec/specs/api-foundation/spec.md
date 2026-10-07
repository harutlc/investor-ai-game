# api-foundation Specification

## Purpose

Defines the HTTP API's baseline behavior that every endpoint inherits: the route prefix, request tracing, logging, consistent error responses, request validation, health reporting and a clean process lifecycle.

## Requirements

### Requirement: API route prefix
The system SHALL serve all application endpoints under the `/api` path prefix.

#### Scenario: Prefixed route
- **WHEN** a client calls `GET /api/health`
- **THEN** the health endpoint responds

### Requirement: Consistent error envelope
The system SHALL return every error response as JSON with the shape `{ "error": { "code": string, "message": string, "details"?: unknown, "requestId": string } }`. `code` MUST be a stable, machine-readable UPPER_SNAKE_CASE identifier. In production, the response MUST NOT include stack traces, internal file paths or messages from unexpected errors. Unexpected errors MUST be returned as HTTP 500 with code `INTERNAL_ERROR` and a generic message.

#### Scenario: Unknown route
- **WHEN** a client calls `GET /api/does-not-exist`
- **THEN** the response is 404 with `error.code = "NOT_FOUND"`

#### Scenario: Unexpected error in production
- **WHEN** a handler throws an unexpected error while `NODE_ENV=production`
- **THEN** the response is 500 with `error.code = "INTERNAL_ERROR"`, a generic message, and no stack trace or original error message

#### Scenario: Malformed JSON body
- **WHEN** a client sends a body that is not valid JSON
- **THEN** the response is 400 with `error.code = "INVALID_JSON"`

### Requirement: Request validation
The system SHALL validate request bodies, route params and query strings against declared schemas before they reach business logic. A validation failure MUST return 400 with `error.code = "VALIDATION_ERROR"` and `details` listing each failing field path and its reason. Unknown body fields MUST be rejected.

#### Scenario: Invalid body
- **WHEN** a client sends a body whose required field is missing to an endpoint with a declared schema
- **THEN** the response is 400 with `error.code = "VALIDATION_ERROR"` and `details` naming the missing field

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

### Requirement: Health endpoint
The system SHALL expose `GET /api/health`, which returns `{ "status": "ok" | "degraded", "uptime": number, "checks": { "database": "ok" | "error", "thinking": "ok" | "error", "decision": "ok" | "error" } }`.
- It returns 200 with `status: "ok"` when the database answers a trivial query, and 503 with `status: "degraded"` when it does not.
- `checks.thinking` and `checks.decision` report the reachability of the active thinking and decision providers. They MUST NOT affect the HTTP status or `status`.
- Provider reachability results MUST be cached for a configurable period (30 seconds by default), so that frequent probes do not hit external services.
- The health endpoint MUST NOT require a CSRF token or a player session, and MUST NOT reveal versions, secrets, configuration or which providers are active.

#### Scenario: Healthy
- **WHEN** a client calls `GET /api/health` and the database is reachable
- **THEN** the response is 200 with `status: "ok"` and `checks.database: "ok"`

#### Scenario: Provider down does not fail health
- **WHEN** the database is reachable but the active thinking provider is not
- **THEN** the response is 200 with `status: "ok"` and `checks.thinking: "error"`

#### Scenario: Cached provider checks
- **WHEN** a client calls `GET /api/health` twice within the cache period
- **THEN** the provider reachability checks run only once

#### Scenario: No provider identity
- **WHEN** a client calls `GET /api/health`
- **THEN** the response contains no provider names, model names or URLs

### Requirement: Graceful shutdown
The system SHALL handle SIGTERM and SIGINT by refusing new connections, letting in-flight requests finish within a configurable timeout (10 seconds by default), closing the database connection and exiting with code 0. If the timeout passes, the process MUST exit with a non-zero code.

#### Scenario: SIGTERM during idle
- **WHEN** the process receives SIGTERM with no requests in flight
- **THEN** it closes the server and database and exits with code 0
