# container-deployment Specification

## Purpose

Lets anyone build and run the whole game (API and web UI) as containers with one command. The containers run the production build, keep the database across restarts, and stay same-origin like the development setup.

## Requirements

### Requirement: Container images from a clean checkout
The repository SHALL provide one container build definition at its root. It produces two images:
- an `api` image, which runs the compiled API;
- a `web` image, which serves the built web UI.

Both images MUST build from a clean checkout. They MUST NOT need host-installed `node_modules`, prebuilt `dist` folders or a local database.

The build MUST NOT copy any of the following into either image:
- `.env` files or other secrets;
- the local `data/` directory;
- `.git`.

#### Scenario: Build from a clean checkout
- **WHEN** a fresh clone with no `node_modules`, `dist` or `data/` is built for the `api` and `web` targets
- **THEN** both images build successfully

#### Scenario: Secrets stay out of the image
- **WHEN** the repo root contains a `.env` with `COOKIE_SECRET` set and the images are built
- **THEN** neither image contains a `.env` file or the secret's value

### Requirement: API container runtime
The `api` container SHALL run the compiled API, not the TypeScript sources and not a watch-mode dev server. Its runtime behavior:
- It runs as a non-root user.
- It listens on port 3001 inside the container.
- It defaults to `NODE_ENV=production`.
- It reads secrets and provider settings only from its environment.
- It MUST NOT need development dependencies at runtime.
- It applies pending database migrations on startup, as it does outside a container.

#### Scenario: Starts in production mode
- **WHEN** the `api` container starts with a valid `COOKIE_SECRET` and non-fake providers, and no `NODE_ENV` override
- **THEN** the API listens on port 3001, reports production mode, and the dev playground routes return 404

#### Scenario: Invalid configuration fails fast
- **WHEN** the `api` container starts without `COOKIE_SECRET`
- **THEN** the container exits with a non-zero code and its log names `COOKIE_SECRET` as missing

#### Scenario: Fake providers refused in production
- **WHEN** the `api` container starts in production mode with `THINKING_PROVIDER=fake`
- **THEN** the container exits with a non-zero code and a message that fake providers are not allowed in production

### Requirement: Persistent game data
The SQLite database used by the `api` container SHALL be stored on a named volume, so players, games and turns survive these events:
- the container restarting;
- the container being recreated;
- the images being rebuilt.

Removing the volume explicitly MUST be the only way the stack loses that data.

#### Scenario: Data survives a rebuild
- **WHEN** a player starts a game, then the stack is stopped, rebuilt and started again with the same volume
- **THEN** the player's game is still listed for the same player cookie

#### Scenario: First start creates the database
- **WHEN** the stack starts with an empty volume
- **THEN** the API creates the database, applies all migrations and `GET /api/health` reports `checks.database = "ok"`

### Requirement: Same-origin web serving and API proxy
The `web` container SHALL serve the built UI. It SHALL also forward every request under `/api/` to the `api` service, so the browser talks to one origin and the player cookie stays first-party. In addition:
- Requests for client-side routes that match no static file MUST return the UI's `index.html`.
- The proxy MUST pass the client's address in `X-Forwarded-For`.
- The proxy MUST allow at least 120 seconds for an API response, because a negotiation turn can wait on slow LLM providers.
- Hashed static assets MUST be cacheable long-term.
- `index.html` MUST NOT be cached, so a new deployment takes effect on the next load.

#### Scenario: UI loads
- **WHEN** a browser opens `http://localhost:8080/`
- **THEN** the web UI loads and its API calls go to `http://localhost:8080/api/...`

#### Scenario: Deep link
- **WHEN** a browser opens `http://localhost:8080/games/<id>` directly
- **THEN** the response is the UI's `index.html` with status 200, and the UI routes to that game

#### Scenario: API proxied
- **WHEN** a client sends `GET http://localhost:8080/api/health`
- **THEN** the response is the API's health JSON

#### Scenario: Per-client rate limiting behind the proxy
- **WHEN** two clients with different IP addresses send requests through the `web` container
- **THEN** the API counts their requests against separate rate-limit buckets

#### Scenario: Slow turn is not cut off
- **WHEN** a turn request takes 90 seconds because the thinking provider is slow
- **THEN** the proxy waits and returns the API's response, not a gateway timeout

### Requirement: One-command orchestration
The repository SHALL provide a Compose file. Running `docker compose up --build` from the repo root with a valid `.env` builds and starts both services:
- Only the `web` service MUST publish a host port. The default is `8080`, and `WEB_PORT` overrides it.
- The `api` service MUST be reachable only through the `web` proxy.
- The `api` service MUST have a healthcheck based on `GET /api/health`.
- The `web` service MUST NOT start until that healthcheck passes.
- Secrets and provider keys MUST come from the repo's `.env`.
- `NODE_ENV` MUST default to `production` and MUST be overridable with `DOCKER_NODE_ENV`. A `NODE_ENV` value in `.env` for local development MUST NOT change the containers' mode.

#### Scenario: One command starts the game
- **WHEN** a user with Docker and a `.env` containing `COOKIE_SECRET` runs `docker compose up --build`
- **THEN** both services start, the `api` service becomes healthy, and the game is playable at `http://localhost:8080`

#### Scenario: API port not published
- **WHEN** the stack is running with the default Compose file
- **THEN** port 3001 on the host is not bound by the stack

#### Scenario: Development override
- **WHEN** the user runs the stack with `DOCKER_NODE_ENV=development`, `THINKING_PROVIDER=fake` and `DECISION_PROVIDER=fake`
- **THEN** the API starts with fake providers and the game is playable with no LLM services running

#### Scenario: Local .env mode does not leak into containers
- **WHEN** `.env` contains `NODE_ENV=development` and `DOCKER_NODE_ENV` is unset
- **THEN** the `api` container runs in production mode

### Requirement: Reaching LLM providers on the host
By default, the Compose setup SHALL point the API's Ollama and Laya base URLs at the Docker host (`host.docker.internal`, on their default ports 11434 and 8000), so providers running on the developer's machine are reachable from the container. This MUST work on Docker Desktop and on Linux Docker Engine. The user MUST be able to override each URL. Hosted providers (Anthropic, Jev) MUST work with only their API keys in `.env`.

#### Scenario: Host Ollama reachable
- **WHEN** Ollama runs on the host at port 11434 and the stack starts with `THINKING_PROVIDER=ollama`
- **THEN** `GET /api/health` through the web proxy reports `checks.thinking = "ok"`

#### Scenario: Linux host
- **WHEN** the stack runs on Linux Docker Engine (not Docker Desktop)
- **THEN** `host.docker.internal` resolves inside the `api` container to the host

### Requirement: Graceful container stop
Stopping the stack (`docker compose down` or `docker compose stop`) SHALL deliver SIGTERM to the API process. The API then shuts down as it does outside a container: in-flight requests finish, the database closes, and the process exits with code 0 within the configured shutdown timeout.

#### Scenario: Clean stop
- **WHEN** the stack is stopped while idle
- **THEN** the `api` container logs "shutdown complete" and exits with code 0 well before Docker's stop timeout
