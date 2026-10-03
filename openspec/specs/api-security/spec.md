# api-security Specification

## Purpose

Defines the security controls that apply to every API endpoint: security headers, cross-origin rules, optional CSRF protection for cookie-authenticated mutations, abuse limits and input-size limits. Future endpoints inherit them by default.

## Requirements

### Requirement: Security headers
The system SHALL send hardened security headers on every response, including:
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Resource-Policy: same-site`
- `X-Frame-Options: DENY`

`Strict-Transport-Security` MUST be sent in production only. The `X-Powered-By` header MUST NOT be sent.

#### Scenario: Headers present
- **WHEN** a client calls any endpoint
- **THEN** the response includes `X-Content-Type-Options: nosniff` and a `Content-Security-Policy` containing `default-src 'none'`, and has no `X-Powered-By` header

#### Scenario: HSTS only in production
- **WHEN** the API runs with `NODE_ENV=development`
- **THEN** responses do not include `Strict-Transport-Security`

### Requirement: CORS allowlist
The system SHALL allow cross-origin requests only from the configured list of exact origins, with credentials allowed. Wildcard origins MUST be rejected by config validation. Allowed methods MUST be limited to GET, POST, PUT, PATCH, DELETE and OPTIONS. Allowed request headers MUST be limited to `Content-Type`, `X-CSRF-Token` and `X-Request-Id`. Responses to disallowed origins MUST NOT include `Access-Control-Allow-Origin`.

#### Scenario: Allowed origin preflight
- **WHEN** a preflight `OPTIONS` request arrives from `http://localhost:5173` (configured)
- **THEN** the response includes `Access-Control-Allow-Origin: http://localhost:5173` and `Access-Control-Allow-Credentials: true`

#### Scenario: Disallowed origin
- **WHEN** a request arrives from `https://evil.example`
- **THEN** the response has no `Access-Control-Allow-Origin` header

#### Scenario: Wildcard rejected
- **WHEN** the configured origins contain `*`
- **THEN** startup fails with a configuration error

### Requirement: CSRF protection
CSRF protection SHALL be controlled by the `security.csrf.enabled` setting, which the `CSRF_ENABLED` environment variable (`true` / `false`) overrides. It is disabled in the committed configuration.

When enabled, the system SHALL protect every state-changing request (POST, PUT, PATCH, DELETE) with a CSRF token that is bound to the caller's player session, using the signed double-submit cookie pattern:
- `GET /api/csrf-token` MUST return `{ "csrfToken": string }` and set the matching CSRF cookie.
- A state-changing request MUST carry the token in the `X-CSRF-Token` header.
- A missing, invalid or session-mismatched token MUST be rejected with 403 and `error.code = "CSRF_INVALID"`.
- `CSRF_SECRET` MUST be set, or startup fails.

When disabled, state-changing requests MUST NOT require a token, no CSRF cookie is issued, `GET /api/csrf-token` MUST respond 404 `NOT_FOUND`, and `CSRF_SECRET` is not required. Cross-site writes then remain blocked by `SameSite=Lax` cookies, JSON-only request bodies and the CORS allowlist.

In both modes, GET, HEAD and OPTIONS requests MUST NOT require a token, and therefore MUST NOT change state.

#### Scenario: Valid token
- **WHEN** CSRF protection is enabled and a client fetches a token from `GET /api/csrf-token` and sends a POST with that token in `X-CSRF-Token` and the issued cookies
- **THEN** the request passes CSRF validation

#### Scenario: Missing token
- **WHEN** CSRF protection is enabled and a client sends a POST with the session cookies but no `X-CSRF-Token` header
- **THEN** the response is 403 with `error.code = "CSRF_INVALID"`

#### Scenario: Token from another session
- **WHEN** CSRF protection is enabled and a client sends a POST with a token issued to a different player session
- **THEN** the response is 403 with `error.code = "CSRF_INVALID"`

#### Scenario: Safe methods unaffected
- **WHEN** a client calls `GET /api/health` without a token
- **THEN** the request succeeds

#### Scenario: Disabled
- **WHEN** CSRF protection is disabled and a client sends a JSON POST with only the session cookie
- **THEN** the request is not rejected for CSRF, and `GET /api/csrf-token` responds 404 `NOT_FOUND`

#### Scenario: Secret required only when enabled
- **WHEN** `CSRF_ENABLED=true` and `CSRF_SECRET` is unset
- **THEN** startup fails with a message naming `CSRF_SECRET`; with CSRF disabled, startup succeeds without it

### Requirement: Hardened cookies
The system SHALL issue every cookie it sets with `HttpOnly`, `SameSite=Lax` and `Path=/`, and with `Secure` when `NODE_ENV=production`. Cookies holding identity or CSRF secrets MUST be signed or HMAC-bound with server-side secrets. In production, the CSRF cookie (issued only when CSRF protection is enabled) MUST use the `__Host-` name prefix.

#### Scenario: Production cookie flags
- **WHEN** CSRF protection is enabled and the API issues the CSRF cookie with `NODE_ENV=production`
- **THEN** the `Set-Cookie` header uses the `__Host-` prefix and includes `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`

### Requirement: JSON-only mutating requests
The system SHALL accept only `Content-Type: application/json` on POST, PUT and PATCH requests that have a body. Other content types MUST be rejected with 415 and `error.code = "UNSUPPORTED_MEDIA_TYPE"`.

#### Scenario: Form post rejected
- **WHEN** a client sends a POST with `Content-Type: application/x-www-form-urlencoded`
- **THEN** the response is 415 with `error.code = "UNSUPPORTED_MEDIA_TYPE"`

### Requirement: Body size limit
The system SHALL reject request bodies larger than the configured limit (100 KB by default) with 413 and `error.code = "PAYLOAD_TOO_LARGE"`.

#### Scenario: Oversized body
- **WHEN** a client sends a 200 KB JSON body
- **THEN** the response is 413 with `error.code = "PAYLOAD_TOO_LARGE"`

### Requirement: Rate limiting
The system SHALL limit the number of requests per client IP over a configurable window. Defaults: 300 requests per 15 minutes globally, and a stricter configurable limit for state-changing requests. Over the limit, the response MUST be 429 with `error.code = "RATE_LIMITED"` and the standard `RateLimit-*` headers. The health endpoint MUST be exempt from the global limit.

#### Scenario: Limit exceeded
- **WHEN** a client exceeds the configured request limit within the window
- **THEN** subsequent requests receive 429 with `error.code = "RATE_LIMITED"` until the window resets

### Requirement: Proxy awareness
The system SHALL trust `X-Forwarded-*` headers only when `trust proxy` is explicitly configured. Without that config, rate limiting and logging MUST use the socket's remote address.

#### Scenario: Spoofed forwarded header
- **WHEN** `trust proxy` is not configured and a client sends `X-Forwarded-For: 1.2.3.4`
- **THEN** rate limiting keys on the socket address, not on `1.2.3.4`
