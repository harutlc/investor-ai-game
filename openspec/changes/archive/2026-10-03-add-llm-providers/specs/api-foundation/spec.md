## MODIFIED Requirements

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
