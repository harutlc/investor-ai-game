## Why

Running the game today takes Node 22.12+, pnpm 10, a C/C++ toolchain for `better-sqlite3` and two terminals (`pnpm dev` + `pnpm dev:web`). There is no production-style way to run the API and the web UI together. A Docker setup lets anyone start the whole game with one command, and it exercises the real production path (compiled API, built UI, `NODE_ENV=production`), which the dev servers never do.

## What Changes

- Add a multi-stage `Dockerfile` at the repo root with two targets:
  - `api`: the compiled Express API (`apps/api/dist` + `packages/shared/dist`), production dependencies only, run as a non-root user.
  - `web`: the Vite build of `apps/web` served by nginx. nginx also reverse-proxies `/api` to the API container, so the browser sees one origin, just like the Vite dev proxy.
- Add `docker-compose.yml` with `api` and `web` services:
  - Only the web port is published (default `8080`).
  - SQLite lives in a named volume, so data survives restarts and container rebuilds.
  - The API has a healthcheck on `/api/health`, and web waits for it.
  - Secrets come from the existing `.env`.
  - `NODE_ENV` defaults to `production` and can be overridden with `DOCKER_NODE_ENV`.
  - `OLLAMA_BASE_URL` and `LAYA_BASE_URL` default to `host.docker.internal`, so the containers can reach Ollama and laya-serve running on the host. This also works on Linux.
- Add `.dockerignore` so `node_modules`, `dist`, `data/`, `.env*` and `.git` never enter the build context. Secrets are never baked into an image.
- Add a `TRUST_PROXY` environment override for `server.trustProxy`. Behind nginx, every request would otherwise come from the proxy's IP, so all players would share one rate-limit bucket. Compose sets `TRUST_PROXY=1`. The committed config keeps `false`, so dev behavior does not change.
- Document the Docker workflow in the README: prerequisites, `.env`, provider setup, the production-mode cookie caveat over plain HTTP, and the development-mode override.

No existing behavior changes when the app runs outside Docker.

## Capabilities

### New Capabilities
- `container-deployment`: building the API and web images, running them together with Compose, same-origin `/api` proxying, persisting the database, health-gated startup, reaching host LLM providers, and graceful container stop.

### Modified Capabilities
- `app-config`: the "Environment overrides" requirement gains `TRUST_PROXY`, which overrides `server.trustProxy`.

## Impact

- **New files**: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `docker/nginx.conf`.
- **Code**: `apps/api/src/config/ConfigLoader.ts` (one new env override plus its parser) and its tests. `.env.example` documents `TRUST_PROXY` and the `DOCKER_*` compose variables.
- **Docs**: a new README "Docker" section, and the configuration table gains `TRUST_PROXY`.
- **Dependencies**: no new npm packages. The base images are `node:24-bookworm-slim` (build and API runtime) and `nginxinc/nginx-unprivileged` (web).
- **Runtime**: in production mode, cookies are `Secure` with the `__Host-` prefix. Chrome and Firefox accept them on `http://localhost`. Other browsers or non-localhost hosts need TLS in front, or `DOCKER_NODE_ENV=development`. Fake LLM providers are refused in production, so a zero-dependency demo needs the development override.
