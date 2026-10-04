## Context

The repo is a pnpm 10 workspace (`pnpm@10.33.0` pinned in `packageManager`) with three packages: `apps/api`, `apps/web` and `packages/shared`. See proposal.md for the motivation.

Facts about the current code that shape the container layout:

- **Workspace root.** The API finds the repo root by walking up to `pnpm-workspace.yaml` (`WorkspaceRoot.find(process.cwd())`). It then loads `config/app.config.json` and an optional `.env` from that root.
- **Database.** `database.file` (`./data/game.sqlite`) resolves against the root.
- **Migrations.** Migrations are read from `apps/api/src/db/migrations`, even by the built API. `Database.ts` resolves `../../src/db/migrations` from `dist/db`.
- **Build.**
  - `pnpm build` (`tsc -b`) emits `packages/shared/dist` and `apps/api/dist`.
  - At runtime the API imports `@investor/shared` through its `default` export (`./dist/index.js`), because the `development` condition is off outside tsx and Vitest.
  - `vite build` writes `apps/web/dist` and bundles `shared` from its sources via an alias.
- **Web client configuration.** The web client reads `VITE_API_URL` and `VITE_CSRF_ENABLED` at build time. Empty `VITE_API_URL` means relative `/api` paths (same-origin).
- **Native dependency.** `better-sqlite3` is native. It is listed in `onlyBuiltDependencies`, so pnpm runs its install script, which downloads a prebuilt binary or compiles one.
- **Production mode behavior.**
  - Cookies are `Secure`, with the `__Host-` prefix.
  - HSTS is sent.
  - Fake providers are refused.
  - The dev playground is not mounted.
- **Trust proxy.** `server.trustProxy` is `false` in the committed config and has no environment override yet.

## Goals / Non-Goals

**Goals:**
- Small, non-root runtime images that hold only what each process needs.
- The image layer cache survives source edits: dependencies are installed from the manifests and lockfile before the sources are copied.
- The browser sees one origin (`http://localhost:8080`), the same model as the Vite dev proxy. CORS and cookie behavior stays the same.
- Nothing about running outside Docker changes.

**Non-Goals:**
- TLS termination, a public deployment, or a registry/CI publishing pipeline.
- Running Ollama or laya-serve in Compose. They stay on the host (or hosted providers are used).
- A hot-reload dev workflow inside containers. `pnpm dev` remains the dev loop.
- Multi-instance scaling. SQLite plus in-memory rate limits assume one API replica.

## Decisions

### 1. One root `Dockerfile` with named targets, built from the repo root
Shared stages:
- **`base`**: `node:24-bookworm-slim` with `corepack enable`.
- **`deps`**: adds `python3 make g++` and runs `pnpm install --frozen-lockfile` from the manifests only.
- **`build`**: copies the sources and runs `pnpm build`, then `pnpm build:web`.

Final targets:
- **`api`**: from `base`, with production dependencies only.
- **`web`**: from nginx, with only `apps/web/dist`.

Compose builds each service with `target:`.

*Alternatives:*
- Per-app Dockerfiles. They duplicate the install and build stages, and both need the repo root as context anyway because of `shared` and the lockfile.
- A single image where Express serves the UI. That needs API code changes, and it mixes static serving into an API that sets `default-src 'none'` CSP.

The user chose the two-image layout.

### 2. Production `node_modules` from a separate `prod-deps` stage, not `pnpm deploy`
The `prod-deps` stage starts from `base`. It installs the build toolchain, copies only the workspace manifests and lockfile, and runs:

```
pnpm install --frozen-lockfile --prod --filter @investor/api...
```

That installs the API and `shared` with no dev dependencies, and builds `better-sqlite3` there.

The `api` stage then copies three things: the root and per-package `node_modules` trees from `prod-deps`, the built `dist` folders from `build`, and the files the API reads at runtime:
- `package.json`
- `pnpm-workspace.yaml`
- `config/`
- `apps/api/package.json`
- `apps/api/src/db/migrations`
- `packages/shared/package.json`

The layout under `/app` matches the repo, so `WorkspaceRoot.find`, the config path, the migrations path and the workspace symlink `node_modules/@investor/shared → packages/shared` all resolve unchanged.

*Alternative:* `pnpm --filter @investor/api deploy --prod`. In pnpm 10 it needs `inject-workspace-packages` or `--legacy`. It also packs `shared` with npm-packlist rules, and those honor `.gitignore`, which lists `dist/`. That risks shipping `shared` without its compiled output. It would also move the API out of the workspace layout that `WorkspaceRoot` relies on.

*Alternative:* `pnpm prune --prod` in the build stage. It is less predictable in a workspace, and it leaves the compiler toolchain in the layer history.

### 3. Toolchain stays out of the runtime image
`python3 make g++` exist only in the `deps` and `prod-deps` stages. The runtime copies the compiled `better-sqlite3` binding.

All Node stages use the same base (Debian bookworm, glibc). That keeps the native ABI identical between the stage that builds the binding and the stage that runs it. Alpine/musl was rejected because it can change which prebuilt binary is used and needs its own toolchain.

### 4. Web served by `nginxinc/nginx-unprivileged` with a committed `docker/nginx.conf`
nginx runs as a non-root user on port 8080. The config does the following:
- `location /api/` does `proxy_pass http://api:3001`, keeping the original path. It sets `Host`, `X-Forwarded-For` (`$proxy_add_x_forwarded_for`), `X-Forwarded-Proto` and `X-Request-Id` passthrough. `proxy_read_timeout` and `proxy_send_timeout` are `180s`, which covers a 60-second provider timeout plus retries.
- `location /assets/` serves Vite's hashed files with `Cache-Control: public, max-age=31536000, immutable`.
- `location /` uses `try_files $uri /index.html`, and `index.html` gets `Cache-Control: no-cache`.
- gzip is on for text, JS, CSS, JSON and SVG. `server_tokens off`.

The web image adds no CSP, because `index.html` has an inline theme script. A hash-based CSP is a possible follow-up.

`VITE_CSRF_ENABLED` is a build argument (default empty). Compose passes `${CSRF_ENABLED:-}`, so the UI matches the API's CSRF setting from the same `.env` value.

### 5. `TRUST_PROXY` env override (the one code change)
`ConfigLoader.ENV_OVERRIDES` gets `{ path: 'server.trustProxy', env: 'TRUST_PROXY', parse: trustProxy }`. The parser works like this:
- `"false"` → `false`.
- A string of digits → a number.
- Otherwise, a comma list → `string[]`. This reuses `commaList`.
- `"true"` is passed through unchanged, so the existing schema rejects it, and `describeIssues` names `(from TRUST_PROXY)`.

Compose sets `TRUST_PROXY=1`. Only nginx can reach the API container, so one trusted hop is accurate, and `req.ip` becomes the real client address for the rate limiters.

*Alternative:* a Docker-specific config file selected with `APP_CONFIG_PATH`. It duplicates the whole config and would drift from the committed one.

### 6. Compose environment: `.env` for secrets, explicit `environment:` for container facts
The `api` service uses `env_file: .env` for secrets, provider choice and keys. Its `environment:` then pins the values that must hold inside the container. Compose gives `environment:` precedence over `env_file`.

| Variable          | Value                                                     |
| ----------------- | --------------------------------------------------------- |
| `NODE_ENV`        | `${DOCKER_NODE_ENV:-production}`                          |
| `PORT`            | `3001`                                                    |
| `DATABASE_FILE`   | `/app/data/game.sqlite`                                   |
| `TRUST_PROXY`     | `1`                                                       |
| `CORS_ORIGINS`    | `http://localhost:${WEB_PORT:-8080}`                      |
| `OLLAMA_BASE_URL` | `${DOCKER_OLLAMA_BASE_URL:-http://host.docker.internal:11434}` |
| `LAYA_BASE_URL`   | `${DOCKER_LAYA_BASE_URL:-http://host.docker.internal:8000}`    |
| `THINKING_PROVIDER`, `DECISION_PROVIDER` | `${THINKING_PROVIDER:-}`, `${DECISION_PROVIDER:-}` (pass-through) |

`DOCKER_*` names are used instead of `NODE_ENV` and `OLLAMA_BASE_URL`. Compose also reads `.env` for `${...}` interpolation, and the dev `.env` sets `NODE_ENV=development` and `OLLAMA_BASE_URL=http://localhost:11434`. Neither is right inside a container.

The provider variables are passed through because `env_file` values cannot be overridden from the shell. Without this, `THINKING_PROVIDER=fake docker compose up` would silently keep the `.env` providers. Interpolation prefers the shell over `.env`, and an empty value counts as unset in the API.

`CORS_ORIGINS` is not needed for same-origin traffic. It is set so the allowlist describes the real origin and does not point at the Vite dev port.

Other service settings:
- `extra_hosts: ["host.docker.internal:host-gateway"]` makes the host name resolve on Linux Docker Engine. Docker Desktop already provides it.
- `init: true` gives the container a minimal init process, which forwards signals and reaps zombies. The CMD is exec-form `["node", "apps/api/dist/main.js"]`, so SIGTERM reaches Node's existing graceful-shutdown handler.
- `stop_grace_period: 15s` is above the 10-second `shutdownTimeoutMs`.
- The healthcheck is `node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`. Node 24 has global `fetch`, so the slim image needs no curl. The health route creates no player rows.
- `web` uses `depends_on: { api: { condition: service_healthy } }` and publishes `${WEB_PORT:-8080}:8080`. `api` publishes no port.
- The named volume `game-data` is mounted at `/app/data`. The `api` stage creates `/app/data` owned by `node` before `USER node`, so the volume starts out writable by the app user.

### 7. `.dockerignore` as an allowlist-minded denylist
Excluded paths:
- `**/node_modules`, `**/dist`, `coverage`, `*.tsbuildinfo`
- `data`, `*.sqlite*`
- `.env`, `.env.*` (but `!.env.example`)
- `.git`, `.idea`, `.claude`, `.agents`, `openspec`, `postman`
- the large markdown docs

This keeps the context small, keeps secrets out, and stops host-built native modules (macOS `better-sqlite3`) from leaking into a Linux image.

## Risks / Trade-offs

- **[`Secure`/`__Host-` cookies over plain HTTP in production mode]** Chrome and Firefox treat `http://localhost` as a secure context and accept them. Other browsers, or a LAN IP or hostname, drop them, and every request becomes a new anonymous player. → The README explains this. `DOCKER_NODE_ENV=development` gives non-Secure cookies, and TLS in front is the real fix.
- **[HSTS in production on localhost]** The API sends HSTS. Browsers ignore it over HTTP, so nothing sticks to `localhost`. → No action. The README notes that TLS deployments get HSTS as intended.
- **[Fake providers refused in production]** A user without Ollama, Laya or API keys gets a fail-fast exit. → The README documents the development override, and the error message already names the problem.
- **[Host provider reachability]** Ollama bound to `127.0.0.1` on Linux is unreachable through `host-gateway`. → The README says to run `OLLAMA_HOST=0.0.0.0 ollama serve` on Linux. Health reports `thinking: "error"` instead of failing the stack.
- **[No prebuilt `better-sqlite3` for an architecture]** → The toolchain in `prod-deps` compiles from source, so the build is slower but still succeeds.
- **[Single replica]** SQLite on a volume and in-memory rate limits assume one API instance. → This is a documented non-goal. Compose does not set `deploy.replicas`.
- **[Corepack availability]** Corepack ships with Node 24 but is dropped from later Node majors. → The base image is pinned to `node:24-*`. Moving to `npm i -g pnpm@<pinned>` is a one-line change if the base changes.

## Migration Plan

Additive only. Existing dev and production commands are unaffected. `TRUST_PROXY` is unset outside Compose, so `server.trustProxy` stays `false`. To roll back, delete the Docker files and the one env override.
