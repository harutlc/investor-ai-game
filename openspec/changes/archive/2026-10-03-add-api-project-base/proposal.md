## Why

The repository holds only the game design (`TASKS.md`) and the homework brief. No code exists yet. Every later feature (LLM and decision providers, the investor brain, the game engine, the web UI) needs one shared foundation: a TypeScript monorepo, an Express API with a clear controller → service → repository layering, validated configuration, a database, and API security that is correct from day one rather than added later.

## What Changes

- Create a **pnpm workspace monorepo**: a root `package.json`, `pnpm-workspace.yaml`, a strict `tsconfig.base.json`, ESLint + Prettier, `.editorconfig`, `.gitignore`, `.env.example` and a `README.md`.
- Add **`packages/shared`**: zod set up as the single source of runtime validation and TS types, plus the shared API error envelope schema (`{ error: { code, message, details? } }`).
- Add **`apps/api`**, an Express 5 + TypeScript API built from classes:
  - `ConfigLoader` / `AppConfig`: `config/app.config.json` plus `.env`, validated with zod. Startup fails with a clear message when config is invalid.
  - A manual DI `Container` that wires config → database → repositories → services → controllers → `ApiServer`.
  - Layering: **controllers** (HTTP only) → **services** (business logic) → **repositories** (data access only).
  - `Database` class (Drizzle ORM + `better-sqlite3`). It runs migrations at startup and supports `:memory:` for tests.
  - The first real table and repository, **`players`**, which is used by the anonymous player session.
  - Cross-cutting middleware: request ID, structured logging (`pino-http` with redaction), zod validation, 404, and a central error handler that never leaks stack traces in production.
  - `GET /api/health` (liveness plus a DB check), `GET /api/csrf-token`, and `GET /api/session` (the current anonymous player).
  - Graceful shutdown on SIGTERM/SIGINT.
- **API security baseline**:
  - `helmet` with an API-appropriate config
  - a strict **CORS** allowlist from config, with credentials
  - **CSRF** protection with the signed double-submit cookie pattern (`csrf-csrf`) on every state-changing method
  - an anonymous player identity in a signed, `httpOnly`, `SameSite=Lax` cookie (`Secure` in production)
  - rate limiting (`express-rate-limit`)
  - a JSON body size limit, and `application/json` enforced on mutating requests
  - `x-powered-by` disabled and `trust proxy` configurable
  - secrets only from env: `COOKIE_SECRET` and `CSRF_SECRET` are required, with a minimum length
- **Testing**: Vitest + Supertest, with an in-memory database, covering config, the security middleware, the session and health.
- Out of scope, left to later changes: `apps/web`, LLM and decision providers, personas, game tables and engine, and everything else marked MVP/v2/v3 in `TASKS.md` beyond §2–§3 and the infrastructure parts of §5 and §14.

## Capabilities

### New Capabilities
- `app-config`: loads and validates the config file and environment, applies env overrides and fails fast with a clear message.
- `api-foundation`: the Express server lifecycle, request IDs and logging, the consistent error envelope, request validation, 404, the health endpoint and graceful shutdown.
- `api-security`: security headers, the CORS allowlist, CSRF protection, rate limiting, body limits, content-type enforcement and secret handling.
- `player-session`: the anonymous player identity, issued in a signed cookie and stored in the `players` table, so future resources (games) can be scoped to their owner.

### Modified Capabilities
<!-- None: no specs exist yet. -->

## Impact

- **New code**: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.editorconfig`, `.gitignore`, `.env.example`, `README.md`, `config/app.config.json`, `packages/shared/**`, `apps/api/**`.
- **Dependencies**:
  - runtime: express@5, helmet, cors, csrf-csrf, cookie-parser, express-rate-limit, pino, pino-http, zod, dotenv, drizzle-orm, better-sqlite3
  - dev: typescript, tsx, vitest, supertest, drizzle-kit, eslint, typescript-eslint, prettier
- **Runtime**: Node.js 22.12+ (Node 24 is installed locally; Vitest 5 and better-sqlite3 13 require 22+) and pnpm 10. TypeScript is pinned to 6.0 for `typescript-eslint` compatibility.
- **API surface (new)**: `GET /api/health`, `GET /api/csrf-token`, `GET /api/session`. Every future mutating endpoint inherits CSRF, CORS and rate limiting automatically.
- **Web client contract**: the future `apps/web` must send `credentials: "include"`, fetch a CSRF token once, and send it as `X-CSRF-Token` on POST/PUT/PATCH/DELETE.
