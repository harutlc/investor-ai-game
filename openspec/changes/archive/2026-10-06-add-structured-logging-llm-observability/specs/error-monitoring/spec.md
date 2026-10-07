## Purpose

Defines how the API reports to Sentry. The application log stream is forwarded as Sentry Logs, error-level lines become Sentry error events, and LLM failures arrive alongside both, tied to the same request.

## ADDED Requirements

### Requirement: Sentry initialised first
The system SHALL initialise the Sentry SDK before any application module, including the logger, is loaded. When `SENTRY_DSN` is empty or unset, the SDK MUST stay disabled and the API MUST run normally without sending anything. The API's Sentry SDK dependency MUST be version 10.18.0 or later.

#### Scenario: No DSN
- **WHEN** the API starts with `SENTRY_DSN` unset and an error is logged
- **THEN** the API keeps serving requests and nothing is sent to Sentry

#### Scenario: Logger created after Sentry
- **WHEN** the API starts with a DSN
- **THEN** the first log line the application writes is already eligible for forwarding to Sentry

### Requirement: Log lines forwarded as Sentry Logs
With a DSN configured, every application log line at `info`, `warn` or `error` level SHALL be sent to Sentry as a Sentry Log with the same level, message and structured fields, after redaction. Lines at `trace`, `debug` and `fatal` level MUST NOT be sent as Sentry Logs. Forwarded lines MUST include the request ID when the line has one.

#### Scenario: Info line forwarded
- **WHEN** a request completes and the request log line is written at `info`
- **THEN** a Sentry Log at level `info` arrives with the method, path, status, duration and `requestId`

#### Scenario: Debug line not forwarded
- **WHEN** a `debug` line is written while `LOG_LEVEL=debug`
- **THEN** it appears in the local log output and is not sent to Sentry

#### Scenario: Redacted before forwarding
- **WHEN** a line containing an `Authorization` header is forwarded
- **THEN** the Sentry Log shows the header as `[Redacted]`

### Requirement: Error-level lines captured as error events
With a DSN configured, every log line at `error` or `fatal` level SHALL also create a Sentry error event. The event MUST be marked as handled, MUST carry the line's error (with its stack trace) when the line has one, and MUST be tagged with the request ID when the line has one. Lines at `warn` level and below MUST NOT create error events.

The same failure MUST NOT create more than one Sentry error event. When an error has already been reported through a log line, the HTTP error handler MUST NOT report it again.

#### Scenario: Unhandled route error
- **WHEN** a route throws an unexpected error and the request fails with 500
- **THEN** exactly one Sentry error event is created for it, tagged with the request's ID

#### Scenario: Client error not reported
- **WHEN** a request fails validation with 400 and a `warn` line is written
- **THEN** no Sentry error event is created

#### Scenario: Fatal at shutdown
- **WHEN** an uncaught exception is logged at `fatal` and the process exits
- **THEN** the error event is flushed to Sentry before the process exits
