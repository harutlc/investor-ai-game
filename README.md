# Investor Negotiation Game

The player pitches a startup to an AI investor and negotiates the deal. The game design and roadmap are in [`TASKS.md`](./TASKS.md); the homework brief is in [`homework-en.md`](./homework-en.md).

This README covers the **project base**: the monorepo, the Express API foundation and its security baseline. Game features are added on top of it in later changes.

## Prerequisites

- **Node.js ≥ 22.12** (tested with 24)
- **pnpm 10** (`corepack enable` picks up the version pinned in `package.json`)
- A C/C++ toolchain for the native SQLite driver (`better-sqlite3`). On macOS this is the Xcode Command Line Tools (`xcode-select --install`). Prebuilt binaries are used when one is available.

## Setup

```bash
pnpm install
cp .env.example .env
# generate two different secrets (each must be at least 32 characters)
echo "COOKIE_SECRET=$(openssl rand -base64 48)" >> .env
echo "CSRF_SECRET=$(openssl rand -base64 48)" >> .env
pnpm dev                     # API on http://localhost:3001
curl -i http://localhost:3001/api/health
```

The SQLite database is created at `data/game.sqlite` on first start, and migrations run automatically.

## Scripts (run from the repo root)

| Script                      | What it does                                                            |
| --------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                  | Starts the API with hot reload (`tsx watch`)                            |
| `pnpm build`                | Compiles every package with `tsc -b` into `dist/`                       |
| `pnpm start`                | Runs the built API (`node apps/api/dist/main.js`)                       |
| `pnpm test`                 | Runs the Vitest suites in every package                                 |
| `pnpm typecheck`            | Type-checks sources and tests                                           |
| `pnpm lint` / `pnpm format` | ESLint (type-aware) / Prettier                                          |
| `pnpm db:generate`          | Generates a migration from `apps/api/src/db/schema.ts`                  |
| `pnpm db:migrate`           | Applies migrations with drizzle-kit (the API also does this on startup) |

## Layout

```
apps/api/            Express API
  src/config/        ConfigLoader, AppConfigSchema (zod), WorkspaceRoot
  src/container/     Container: manual dependency injection
  src/db/            Database (better-sqlite3 + Drizzle), schema.ts, migrations/
  src/repositories/  data access only
  src/services/      business logic
  src/http/          ApiServer, controllers/, middleware/
  src/errors/        AppError and one subclass per error
  test/              Vitest + Supertest (in-memory SQLite)
packages/shared/     zod schemas and types shared with the future web app
config/app.config.json   non-secret settings (committed)
.env                 secrets and overrides (git-ignored)
```

## Architecture

Requests flow **controller → service → repository**:

- **Controllers** handle HTTP only: validated input in, DTO out. Each one exposes `basePath` and `routes()`.
- **Services** hold the business rules and throw `AppError` subclasses.
- **Repositories** do data access through Drizzle and return plain records.

Everything is wired with constructor injection in `Container`, the one place where objects are created. Tests build the same container with an in-memory database (`test/support/createTestApp.ts`).

Every error response has the shape `{ "error": { "code", "message", "details"?, "requestId" } }`. The codes are listed in `ErrorCode` in `packages/shared`.

## Configuration

`config/app.config.json` holds non-secret settings. Environment variables (or `.env`) supply the secrets and can override some values:

| Variable                       | Overrides / purpose                                              |
| ------------------------------ | ---------------------------------------------------------------- |
| `COOKIE_SECRET`, `CSRF_SECRET` | **Required.** At least 32 characters each, and they must differ  |
| `NODE_ENV`                     | `development` (default), `production` or `test`                  |
| `PORT`                         | `server.port`                                                    |
| `CORS_ORIGINS`                 | `cors.origins` (a comma-separated list of exact origins; no `*`) |
| `DATABASE_FILE`                | `database.file` (relative to the repo root, or `:memory:`)       |
| `LOG_LEVEL`                    | `logging.level`                                                  |
| `APP_CONFIG_PATH`              | Path to an alternative config file                               |

Invalid configuration stops startup with a list of every problem. Secret values are never printed.

## Security

| Concern         | What the API does                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headers         | `helmet`, set up for an API: `default-src 'none'`, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, `X-Frame-Options: DENY`. HSTS is sent in production only, and `X-Powered-By` is removed |
| CORS            | Exact-match allowlist from config, with credentials. Other origins get no CORS headers, and their preflights end before any session work                                                       |
| Identity        | Anonymous player ID in a signed, `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefix and `Secure` in production). A tampered or unknown cookie gets a new player                               |
| CSRF            | Signed double-submit token (`csrf-csrf`), HMAC-bound to the player ID. Required on POST/PUT/PATCH/DELETE                                                                                       |
| Input           | Only `application/json` bodies on POST/PUT/PATCH, a 100 KB body limit, and strict zod validation that rejects unknown fields                                                                   |
| Abuse           | Per-IP rate limits: a global limit, plus a stricter one for mutating requests. `X-Forwarded-For` is trusted only when `server.trustProxy` is configured                                        |
| Errors and logs | No stack traces or internal messages in production responses. Cookies, authorization and CSRF headers are redacted from logs                                                                   |

### Contract for the web client

```ts
// 1. Always send cookies.
const api = (path: string, init: RequestInit = {}) =>
  fetch(`${API_URL}${path}`, { credentials: 'include', ...init });

// 2. Fetch a CSRF token once (and again after a 403 CSRF_INVALID).
const { csrfToken } = await (await api('/api/csrf-token')).json();

// 3. Send it with every mutating request.
await api('/api/games', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
  body: JSON.stringify({ personaId: 'greedy-shark' }),
});
```

Clearing cookies starts a new anonymous player. This is by design, since the game has no accounts.

## The `development` export condition

`@inverstorm/shared` declares a custom `development` export that points to its TypeScript sources:

- `tsx` (`pnpm dev`) and Vitest run with that condition, so changes to `shared` take effect without a build.
- `pnpm build` and `pnpm start` resolve the compiled `dist/` instead.

If you add a new tool that imports `@inverstorm/shared`, enable that condition in it too.
