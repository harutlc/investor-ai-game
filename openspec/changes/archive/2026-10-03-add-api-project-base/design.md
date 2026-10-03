## Context

This is a greenfield repository (see proposal.md, "Why"). `TASKS.md` §0 fixes the stack: pnpm workspaces, strict TypeScript, Express with classes, zod, Drizzle + SQLite (`better-sqlite3`), Vitest + Supertest, and manual DI through a single `Container`. Its code conventions are one class per file, constructor injection, and no `any`. This change implements only the foundation: the workspace, `packages/shared` basics, and `apps/api` infrastructure plus security. The behavior contracts are in `specs/app-config`, `specs/api-foundation`, `specs/api-security` and `specs/player-session`.

The user decided three things:
- Monorepo, API first. `apps/web` comes later.
- Anonymous player identity in a cookie, with CSRF.
- Drizzle infrastructure plus a single `players` table as the working example of the repository pattern.

Local toolchain: Node 24.14, pnpm 10.33.

## Goals / Non-Goals

**Goals:**
- A layering that every later feature copies: **controller → service → repository**, wired in `Container`.
- Security is on by default: a new route automatically gets headers, CORS, CSRF (if mutating), rate limiting, body limits and validation, with no per-route opt-in.
- Everything is testable without a network or files: in-memory SQLite and a `createTestApp()` helper.
- `pnpm install && pnpm dev` starts the API on `:3001`.

**Non-Goals:**
- Real user accounts, OAuth or JWT.
- Multi-instance deployment. The rate-limit store is in-memory, and there is no Redis.
- Any game, LLM, decision-provider or persona code. The config schema only reserves room for these sections; it does not define them.
- HTTPS termination. That is assumed to be a reverse proxy in production.

## Decisions

### 1. Workspace layout and module system
```
package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js, .prettierrc, .editorconfig, .env.example
config/app.config.json
packages/shared/   src/index.ts, src/errors/ApiErrorSchema.ts, src/errors/ErrorCode.ts
apps/api/
  drizzle.config.ts, vitest.config.ts
  src/main.ts                     bootstrap: config → container → listen → shutdown hooks
  src/config/                     AppConfigSchema.ts, ConfigLoader.ts, AppConfig.ts, WorkspaceRoot.ts
  src/container/Container.ts
  src/db/                         Database.ts, schema.ts, migrations/ (drizzle-kit output, committed)
  src/repositories/               PlayerRepository.ts
  src/services/                   PlayerService.ts, HealthService.ts
  src/http/ApiServer.ts
  src/http/controllers/           HealthController.ts, SessionController.ts, CsrfController.ts
  src/http/middleware/            RequestIdMiddleware.ts, SecurityHeaders.ts, CorsPolicy.ts, RateLimiters.ts,
                                  JsonContentTypeGuard.ts, PlayerSessionMiddleware.ts, CsrfProtection.ts,
                                  ValidationMiddleware.ts, NotFoundMiddleware.ts, ErrorHandlerMiddleware.ts
  src/errors/                     AppError.ts + one subclass per file (NotFoundError, ValidationError, CsrfError, …)
  src/logging/LoggerFactory.ts
  test/                           createTestApp.ts, *.test.ts
```
- **ESM everywhere** (`"type": "module"`), with `module`/`moduleResolution: "NodeNext"`, `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Consuming `@inverstorm/shared` without a build step in dev:** shared's `package.json` `exports` has a custom `"development"` condition that points to `src/index.ts`, and `"default"` points to `dist/index.js`. `tsx` (dev) and Vitest run with that condition. `pnpm build` uses `tsc -b` with project references, so the production `node dist/main.js` resolves the built JS.
  - Alternative considered: always-built shared with `tsc --watch`. It needs an extra watcher process and causes stale-build confusion.
  - Alternative considered: TS path aliases. They break at runtime without a bundler.
- pnpm 10 blocks dependency build scripts by default, so `pnpm-workspace.yaml` sets `onlyBuiltDependencies: [better-sqlite3, esbuild]`. Without it, the native SQLite binding is never compiled.

### 2. Layering and DI
- **Controllers** handle HTTP only. They read the validated input, call a service and shape the response DTO. Each exposes `routes(): Router`, with methods bound in the constructor. They never touch the database.
- **Services** hold the business rules (e.g. `PlayerService.resolveOrCreate(cookieId)` and the lastSeen throttling). They depend on repositories and throw `AppError` subclasses.
- **Repositories** hold the data access only, through Drizzle. They return plain domain records, not Drizzle row types, and contain no business rules.
- **`Container`** builds the whole graph in constructor-injection order: config → logger → database → repositories → services → middleware/controllers → `ApiServer`. Tests build a container with overrides: a logger, a database, a clock, and `extraControllers` for test-only routes, e.g. a mutating endpoint to exercise CSRF before game routes exist.
- Repositories are concrete classes, with no interface + implementation pair. Tests use a real `:memory:` SQLite, which is more faithful than mocks. If a second storage backend ever appears, an interface can be extracted then. Pluggable providers (LLM, decision) will get interfaces in their own changes, as `TASKS.md` says.
  - Alternative considered: a DI framework (tsyringe or inversify). It was rejected because `TASKS.md` mandates manual DI, and decorators add hidden magic.

### 3. Configuration
- Committed `config/app.config.json` (non-secret):
  ```json
  {
    "server":   { "port": 3001, "trustProxy": false, "bodyLimit": "100kb", "shutdownTimeoutMs": 10000 },
    "cors":     { "origins": ["http://localhost:5173"] },
    "security": { "rateLimit": { "windowMs": 900000, "max": 300, "mutationMax": 60 },
                  "sessionMaxAgeDays": 30 },
    "database": { "file": "./data/game.sqlite" },
    "logging":  { "level": "info" }
  }
  ```
  This deviates from `TASKS.md` §3.1, where `server.corsOrigin` is a single string. Here it is `cors.origins` (an array) so that staging and prod can list several origins. The `llm`, `decision` and `game` sections are added by later changes.
- `ConfigLoader`:
  1. Finds the workspace root by walking up from `process.cwd()` to `pnpm-workspace.yaml`. Both `pnpm --filter api dev` (cwd `apps/api`) and the root work.
  2. Loads `.env` from the root with `dotenv`, without overriding real env vars.
  3. Reads the JSON file (`APP_CONFIG_PATH` can override its location).
  4. Applies the env overrides (see the spec).
  5. Validates with zod and reports **all** issues at once.
  6. Returns a deep-frozen `AppConfig`.
  
  Relative paths such as `database.file` are resolved against the workspace root.
- Secrets: `COOKIE_SECRET` and `CSRF_SECRET` (each at least 32 characters, and they must differ). `.env.example` documents generating them with `openssl rand -base64 48`.
- `trustProxy` accepts `false`, a hop count, or a list of CIDRs, and is passed straight to `app.set('trust proxy', …)`. It is never `true`, which would trust any `X-Forwarded-For`.

### 4. Middleware order (in `ApiServer`)
1. `app.disable('x-powered-by')`, then `trust proxy` from config
2. `RequestIdMiddleware`: accepts a UUID `X-Request-Id`, otherwise uses `crypto.randomUUID()`, and sets the response header
3. `pino-http`, using that ID as `genReqId`, with redact paths for the cookie, set-cookie, authorization and x-csrf-token headers
4. `helmet`, with an API profile:
   - `contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }`
   - `crossOriginResourcePolicy: same-site`
   - `referrerPolicy: no-referrer`
   - `hsts` only when `NODE_ENV=production`
5. `cors`:
   - origin is a function that checks an exact-match `Set`
   - `credentials: true`, with explicit methods and allowed headers, `maxAge: 600`
   - a disallowed origin gets no CORS headers (not an error), so the browser blocks it
   - every `OPTIONS` request ends here. `cors` lets preflights from disallowed origins fall through, and without this they would reach the session layer and create player rows
6. Global rate limiter (`express-rate-limit`, `standardHeaders: 'draft-7'`, `legacyHeaders: false`, a JSON handler that throws `RateLimitError`). It skips `/api/health`.
7. **`/api/health` is mounted here**, before cookies and session, so probes create no players.
8. `cookie-parser(COOKIE_SECRET)`
9. `JsonContentTypeGuard`: for POST/PUT/PATCH with a body (`content-length > 0` or `transfer-encoding`), returns 415 unless the type `is('application/json')`
10. `express.json({ limit: bodyLimit, strict: true })`. Its `entity.too.large` and `entity.parse.failed` errors are mapped to 413 and 400 by the error handler.
11. `PlayerSessionMiddleware`, which resolves or creates the player and sets `req.player` (typed by augmenting `Express.Request`)
12. `CsrfProtection` (`csrf-csrf` v4 `doubleCsrf`), with:
    - `getSecret: () => CSRF_SECRET`
    - `getSessionIdentifier: req => req.player.id`
    - `getCsrfTokenFromRequest: req => req.headers['x-csrf-token']`
    - `ignoredMethods: GET, HEAD, OPTIONS`
    - the cookie named `__Host-inv.csrf` in prod and `inv.csrf` in dev
13. Mutation rate limiter (the stricter `mutationMax`, for non-safe methods only)
14. Feature routers under `/api` (`/csrf-token`, `/session`, and future `/games`, …)
15. `NotFoundMiddleware`, then `ErrorHandlerMiddleware`

Rationale:
- Cheap rejections (headers, CORS, rate limit) come before any DB work.
- Session comes before CSRF because the CSRF token is bound to the player ID. This is what stops a token minted for an attacker's session from working with a victim's cookies.
- The content-type guard comes before body parsing, so non-JSON bodies are never parsed.

### 5. Why CSRF at all, and why double-submit
The player cookie is sent automatically by the browser, so state-changing endpoints (future `POST /api/games/:id/turns`) are CSRF-able. `SameSite=Lax` already blocks most cross-site POSTs, but it does not cover same-site subdomain attacks or older browsers. A signed double-submit token bound to the session closes those gaps, and it stays stateless: no server-side token store.
- Alternative considered: synchronizer tokens stored in the DB. That means more writes for no added benefit here.
- Alternative considered: `csurf`. It is deprecated and unmaintained.
- Alternative considered: relying on `SameSite` + CORS alone. Not defense in depth.

Client contract (for the future `apps/web`):
1. `fetch(…, { credentials: 'include' })`
2. `GET /api/csrf-token` once at startup, and again after a 403 `CSRF_INVALID`
3. Send `X-CSRF-Token` on mutating requests

### 6. Player session
- Player cookie name: `__Host-inv.pid` in prod and `inv.pid` in dev. Its value is the player UUID, signed by cookie-parser (`s:` prefix + HMAC). It is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in prod, and `Max-Age` comes from `sessionMaxAgeDays`.
- `PlayerService.resolveOrCreate(signedId | undefined)`:
  - A missing cookie, a bad signature or an unknown ID leads to `create()` with a new `randomUUID()`, and the cookie is (re)issued.
  - Otherwise the service calls `touch()` only if `lastSeenAt` is more than 60 s old.
- The cookie is re-issued on create, and when `touch()` runs. Re-issuing on `touch()` gives a sliding expiry without a `Set-Cookie` on every request.

### 7. Database
- `Database` wraps `better-sqlite3` and enables `journal_mode = WAL` (file DBs only) and `foreign_keys = ON`. It exposes the Drizzle instance, runs `migrate()` from the committed `src/db/migrations` at construction, and has `ping()` (`select 1`) and `close()`.
- Schema: `players(id text pk, created_at integer not null, last_seen_at integer not null)`. Timestamps are stored as epoch ms with Drizzle `mode: 'timestamp_ms'`.
- Scripts: `db:generate` (`drizzle-kit generate`) and `db:migrate` (`drizzle-kit migrate`). Migrations also run automatically at startup, which keeps the dev experience simple. The `data/` directory is created if it is missing, and `*.sqlite*` is git-ignored.
- Alternative considered: Prisma. It was rejected because `TASKS.md` chose Drizzle (no codegen step, TS-first).

### 8. Errors and validation
- `AppError(status, code, message, details?)`, with one subclass per file: `NotFoundError` 404, `ValidationError` 400, `InvalidJsonError` 400, `CsrfError` 403, `UnsupportedMediaTypeError` 415, `PayloadTooLargeError` 413, `RateLimitError` 429.
- `ErrorCode` is a zod enum in `packages/shared`, so the web client can switch on it. `ApiErrorSchema` describes the envelope.
- `ErrorHandlerMiddleware`:
  - maps `AppError` subclasses, body-parser errors and the `csrf-csrf` invalid-token error to the envelope
  - logs 5xx at `error` level with the stack, and 4xx at `warn` without it
  - in production, a non-`AppError` returns a generic message
- `ValidationMiddleware.validate({ body?, params?, query? })` uses zod `.strict()` objects. Express 5 makes `req.query` a getter, so the parsed values go to `res.locals.validated` (typed through a helper), not back onto `req`.
- Express 5 forwards rejected promises from async handlers to the error handler, so no `asyncHandler` wrapper is needed.

### 9. Tooling
- ESLint flat config with `typescript-eslint` `recommendedTypeChecked`, plus `@typescript-eslint/no-explicit-any: error`, `no-floating-promises` and `consistent-type-imports`. It uses `eslint-config-prettier` so it does not fight Prettier.
- Root scripts:
  - `dev`: `pnpm --filter @inverstorm/api dev`, which runs `tsx watch --conditions=development src/main.ts`
  - `build`: `tsc -b`
  - `test`: `pnpm -r test`
  - `lint`, `format`, `typecheck`
  - `db:generate`, `db:migrate`
- `engines.node: ">=22.12"` and `packageManager: pnpm@10.x`. Vitest 5 and better-sqlite3 13 require Node 22+, and Node 20 is already end-of-life.
- TypeScript is pinned to `~6.0`, because `typescript-eslint` 8 supports TypeScript below 6.1 only (TS 7, the native port, is not supported yet).
- Each package has two tsconfigs. `tsconfig.json` type-checks `src` + `test` without emitting, using the `development` condition. `tsconfig.build.json` is the composite build of `src` only, with `customConditions: []` so that it resolves `shared` from `dist`. The root `tsconfig.json` references the build configs. Tests are type-checked and linted but never emitted.
- ESLint disables only the `no-unsafe-*` rules for `**/test/**`, because Supertest bodies and Vitest matchers are typed `any`. `no-explicit-any` stays an error everywhere.

## Risks / Trade-offs

- **[In-memory rate-limit store resets on restart and is per-process]** → This is acceptable for a single-instance homework app. The limiter is built in one class, so a Redis store can be plugged in later.
- **[Anonymous cookies can be cleared, which loses access to past games]** → This is by design for an account-less game. It is documented in the README.
- **[A first request creates a DB row, so a bot can create many players]** → Mitigations: the global rate limit; `/api/health` is excluded from session creation; and a periodic cleanup of stale players can be added later (noted, not built).
- **[`better-sqlite3` native build fails on some machines]** → `onlyBuiltDependencies` in the workspace config, plus a README note about prerequisites (Xcode CLT on macOS).
- **[The custom `development` export condition is easy to forget in a new tool]** → Vitest and tsx configs are set up here, and the README explains the condition.
- **[`SameSite=Lax` cookies don't work if the web app is ever served from a different site than the API]** → Same-site dev (`localhost:5173` → `localhost:3001` is same-site). For a cross-site production deployment, `SameSite=None; Secure` would be needed, which would make CSRF tokens mandatory (already in place).

## Migration Plan

This is a greenfield change, so there is nothing to migrate. Rollback means reverting the commit. The SQLite file is local and disposable.
