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

#### Scenario: Generated ID
- **WHEN** a request arrives without `X-Request-Id`
- **THEN** the response carries a newly generated UUID in `X-Request-Id`

#### Scenario: Malicious ID
- **WHEN** a request arrives with `X-Request-Id: <script>`
- **THEN** the server ignores it and returns a generated UUID instead

### Requirement: Structured logging with redaction
The system SHALL write structured JSON logs (pretty-printed in development) for every request, recording at least the method, path, status, duration and request ID. Logs MUST redact `Cookie`, `Set-Cookie`, `Authorization` and `X-CSRF-Token` header values.

#### Scenario: Cookie redacted
- **WHEN** a request carrying a session cookie is logged
- **THEN** the cookie value is shown as `[Redacted]` in the log line

### Requirement: Health endpoint
The system SHALL expose `GET /api/health`. It returns 200 with `{ "status": "ok", "uptime": number, "checks": { "database": "ok" } }` when the database answers a trivial query, and 503 with `status: "degraded"` when it does not. The health endpoint MUST NOT require a CSRF token or a player session, and MUST NOT reveal versions, secrets or configuration.

#### Scenario: Healthy
- **WHEN** a client calls `GET /api/health` and the database is reachable
- **THEN** the response is 200 with `status: "ok"` and `checks.database: "ok"`

### Requirement: Graceful shutdown
The system SHALL handle SIGTERM and SIGINT by refusing new connections, letting in-flight requests finish within a configurable timeout (10 seconds by default), closing the database connection and exiting with code 0. If the timeout passes, the process MUST exit with a non-zero code.

#### Scenario: SIGTERM during idle
- **WHEN** the process receives SIGTERM with no requests in flight
- **THEN** it closes the server and database and exits with code 0
