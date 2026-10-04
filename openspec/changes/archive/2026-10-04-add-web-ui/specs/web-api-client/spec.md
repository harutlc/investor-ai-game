## Purpose

The web app's typed access to the API. It sends the player's cookies, handles the optional CSRF token, validates every response against the shared contracts, and turns API errors into typed errors the screens can show.

## ADDED Requirements

### Requirement: Configurable API base URL
The web app SHALL prefix every API path with the base URL from `VITE_API_URL`. When the variable is empty or unset, it MUST use relative `/api/...` paths. The development server MUST proxy `/api` to the API on `http://localhost:3001`, so the default setup is same-origin.

#### Scenario: Default development setup
- **WHEN** `VITE_API_URL` is unset and the app requests the personas
- **THEN** the request goes to `/api/personas` on the web app's own origin and the dev server forwards it to the API

#### Scenario: Explicit API origin
- **WHEN** `VITE_API_URL` is `http://localhost:3001`
- **THEN** the request goes to `http://localhost:3001/api/personas`

### Requirement: Cookies on every request
Every API request SHALL be sent with credentials included, so the anonymous player cookie (and the CSRF cookie, when enabled) travel with it, whether the API is same-origin or an allowed cross-origin.

#### Scenario: Player identity survives a reload
- **WHEN** a player starts a game, reloads the page and opens the game list
- **THEN** the started game is listed, because the same player cookie was sent

### Requirement: Validated responses
Every successful response body SHALL be parsed with the matching `@investor/shared` schema before any screen uses it. A body that fails validation MUST surface as a client error with code `BAD_RESPONSE` and MUST NOT be rendered.

#### Scenario: Unexpected field
- **WHEN** a game response carries a field the strict game schema does not allow (for example `budget`)
- **THEN** the call fails with `BAD_RESPONSE` and nothing from that body is shown

### Requirement: Typed API errors
A non-2xx response SHALL become an error carrying the HTTP status and the envelope's `code`, `message` and `requestId`. A response whose body is not a valid error envelope MUST become an error with code `UNKNOWN` and the HTTP status. A network failure MUST become an error with code `NETWORK_ERROR`.

#### Scenario: Turn on a finished game
- **WHEN** the API answers a turn with 409 `{ error: { code: "GAME_FINISHED", … } }`
- **THEN** the caller receives an error with status 409 and code `GAME_FINISHED`

#### Scenario: API down
- **WHEN** the API cannot be reached
- **THEN** the caller receives an error with code `NETWORK_ERROR`

### Requirement: Optional CSRF token
For state-changing requests (POST, PUT, PATCH, DELETE), the web app SHALL get a token from `GET /api/csrf-token` the first time one is needed and send it as `X-CSRF-Token`. If that endpoint answers 404 (CSRF disabled on the server), the app MUST send mutations without the header and MUST NOT ask again. If a mutation fails with 403 `CSRF_INVALID`, the app MUST fetch a fresh token and retry that request exactly once.

#### Scenario: CSRF disabled
- **WHEN** `/api/csrf-token` returns 404 and the player starts a game
- **THEN** `POST /api/games` is sent without an `X-CSRF-Token` header and succeeds

#### Scenario: Expired token
- **WHEN** a turn is rejected with 403 `CSRF_INVALID`
- **THEN** the app fetches a new token and resends the same turn once; a second 403 is reported as an error

#### Scenario: Reads need no token
- **WHEN** the app reads a game
- **THEN** no CSRF token is requested or sent

### Requirement: Cached reads and fresh writes
The app SHALL cache the persona list for the session and SHALL keep a game's view, the game list and the insights in a client cache keyed by game id. A successful start MUST seed the new game's view. A successful turn MUST replace the game's view with the returned session, and MUST mark the game list and that game's insights as stale. A failed turn MUST leave the cached view unchanged.

#### Scenario: Turn result replaces the view
- **WHEN** a turn succeeds
- **THEN** the negotiation screen shows the returned session without a second `GET /api/games/:id`

#### Scenario: Insights refresh after a turn
- **WHEN** the insights sheet is opened after a new turn
- **THEN** the insights are fetched again and include that turn's decisions
