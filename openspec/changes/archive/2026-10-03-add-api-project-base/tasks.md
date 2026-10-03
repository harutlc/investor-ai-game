## 1. Workspace & tooling

- [x] 1.1 Create root `package.json` (`"type": "module"`, `engines.node >=22.12`, `packageManager: pnpm@10`, scripts dev/build/test/lint/format/typecheck/db:generate/db:migrate) and `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `onlyBuiltDependencies: [better-sqlite3, esbuild]`); verify `pnpm install` succeeds and `better-sqlite3` native binding is built (`node -e "require('better-sqlite3')(':memory:')"` from `apps/api`)
- [x] 1.2 Add `tsconfig.base.json` (strict, NodeNext, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `customConditions: ["development"]`) and root `tsconfig.json` with project references; verify `pnpm typecheck` runs clean on empty packages
- [x] 1.3 Add ESLint flat config (typescript-eslint `recommendedTypeChecked`, `no-explicit-any: error`, `no-floating-promises`, `consistent-type-imports`, eslint-config-prettier), `.prettierrc`, `.prettierignore`, `.editorconfig`; verify `pnpm lint` and `pnpm format --check` pass
- [x] 1.4 Add `.gitignore` (`node_modules`, `dist`, `.env`, `data/`, `*.sqlite*`, `coverage`) and `.env.example` (`NODE_ENV`, `PORT`, `CORS_ORIGINS`, `DATABASE_FILE`, `LOG_LEVEL`, `APP_CONFIG_PATH`, `COOKIE_SECRET`, `CSRF_SECRET` with `openssl rand -base64 48` hint); verify `git status` does not show `.env` after creating one

## 2. Shared package

- [x] 2.1 Scaffold `packages/shared` (`@inverstorm/shared`, exports with `development` → `src/index.ts`, `types`/`default` → `dist`), its `tsconfig.json` (typecheck: src + tests) and `tsconfig.build.json` (composite: src only), and Vitest config; verify `pnpm --filter @inverstorm/shared build` emits `dist/index.js` + `.d.ts`
- [x] 2.2 Add `ErrorCode` zod enum (`NOT_FOUND`, `VALIDATION_ERROR`, `INVALID_JSON`, `CSRF_INVALID`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL_ERROR`), `ApiErrorSchema` envelope, and `SessionDto`/`CsrfTokenDto`/`HealthDto` schemas; verify unit tests parse valid envelopes and reject malformed ones

## 3. API app scaffold & configuration

- [x] 3.1 Scaffold `apps/api` (`@inverstorm/api`, deps: express@5, helmet, cors, cookie-parser, csrf-csrf, express-rate-limit, pino, pino-http, pino-pretty (dev), zod, dotenv, drizzle-orm, better-sqlite3; dev: tsx, vitest, supertest, drizzle-kit, @types/*), `tsconfig.json` (typecheck) + `tsconfig.build.json` referencing shared's build config, `vitest.config.ts` with `resolve.conditions: ['development']`, scripts `dev` (`tsx watch --conditions=development src/main.ts`), `build`, `start`, `test`; verify `pnpm --filter @inverstorm/api typecheck` passes
- [x] 3.2 Add `config/app.config.json` per design §3 and `WorkspaceRoot` (walks up to `pnpm-workspace.yaml`); verify a unit test resolves the root from `apps/api` cwd
- [x] 3.3 Implement `AppConfigSchema` (zod; port int 1–65535, origins as URL list rejecting `*`, trustProxy `false | number | string[]`, secrets ≥32 chars and distinct, `nodeEnv` enum) and `ConfigLoader` (dotenv from root without override, JSON read, env overrides `PORT`/`CORS_ORIGINS`/`DATABASE_FILE`/`LOG_LEVEL`/`NODE_ENV`, relative paths resolved against root, deep-freeze) returning `AppConfig`; verify tests: valid config, env override wins, missing `COOKIE_SECRET` named, short secret message without value, `server.port: "abc"` names `server.port`, wildcard origin rejected, frozen object throws on assignment
- [x] 3.4 Implement `LoggerFactory` (pino; pretty in development; redact `req.headers.cookie`, `req.headers.authorization`, `req.headers["x-csrf-token"]`, `res.headers["set-cookie"]`); verify a test that a logged cookie header appears as `[Redacted]`

## 4. Database & repository

- [x] 4.1 Add `src/db/schema.ts` (`players`: `id` text PK, `created_at`, `last_seen_at` as `timestamp_ms`) and `drizzle.config.ts`; run `pnpm db:generate` and verify a migration SQL file is created under `src/db/migrations`
- [x] 4.2 Implement `Database` class (creates parent dir for file DBs, WAL for file DBs, `foreign_keys = ON`, runs migrations on construct, `ping()`, `close()`); verify test with `:memory:` that `players` table exists and `ping()` resolves
- [x] 4.3 Implement `PlayerRepository` (`findById`, `create`, `touch(id, at)`) returning plain `Player` records; verify repository tests against `:memory:` DB

## 5. Errors & core middleware

- [x] 5.1 Implement `AppError` and subclasses (`NotFoundError`, `ValidationError`, `InvalidJsonError`, `CsrfError`, `UnsupportedMediaTypeError`, `PayloadTooLargeError`, `RateLimitError`), one class per file, using `ErrorCode` from shared; verify each maps to the documented status in a unit test
- [x] 5.2 Implement `RequestIdMiddleware` (accept UUID `X-Request-Id` else `randomUUID()`, set response header); verify tests for generated ID, valid passthrough, and `<script>` replaced
- [x] 5.3 Implement `ValidationMiddleware.validate({ body, params, query })` with strict zod objects storing results in `res.locals.validated` plus a typed accessor; verify a test route returns 400 `VALIDATION_ERROR` with field paths for missing and unknown fields
- [x] 5.4 Implement `NotFoundMiddleware` and `ErrorHandlerMiddleware` (AppError → envelope with `requestId`; body-parser `entity.parse.failed` → 400 `INVALID_JSON`, `entity.too.large` → 413; csrf-csrf invalid token → 403 `CSRF_INVALID`; unknown → 500 `INTERNAL_ERROR`, generic message in production; 5xx logged with stack); verify tests for 404, malformed JSON, and a thrown `Error("secret detail")` in production not leaking message or stack

## 6. Security middleware

- [x] 6.1 Implement `SecurityHeaders` (helmet API profile per design §4, HSTS only in production) and disable `x-powered-by`; verify tests: `nosniff`, CSP contains `default-src 'none'`, no `X-Powered-By`, no HSTS in development, HSTS present in production
- [x] 6.2 Implement `CorsPolicy` (exact-match origin set, credentials, explicit methods/headers, `maxAge: 600`); verify tests: allowed preflight returns ACAO + credentials, `https://evil.example` gets no ACAO
- [x] 6.3 Implement `RateLimiters` (global limiter skipping `/api/health`, mutation limiter for non-safe methods, draft-7 headers, handler throwing `RateLimitError`) and apply `trust proxy` from config; verify tests with a low `max`: 429 `RATE_LIMITED` with `RateLimit` header, health exempt, spoofed `X-Forwarded-For` ignored when trustProxy is false
- [x] 6.4 Implement `JsonContentTypeGuard` (POST/PUT/PATCH with body must be `application/json`) and configure `express.json({ limit, strict })`; verify tests: form-urlencoded POST → 415, 200 KB JSON → 413, empty-body POST passes guard

## 7. Player session & CSRF

- [x] 7.1 Implement `PlayerService.resolveOrCreate(cookieValue)` (create on missing/invalid/unknown, `touch` only if `lastSeenAt` > 60 s old, report whether cookie must be (re)issued) with an injectable clock; verify unit tests for new, returning, unknown-id, and throttled-touch cases
- [x] 7.2 Implement `PlayerSessionMiddleware` (reads signed cookie via cookie-parser, sets `req.player` via `Express.Request` augmentation, issues `inv.pid` / `__Host-inv.pid` with HttpOnly, SameSite=Lax, Path=/, Secure in prod, Max-Age from config); verify tests: first visit sets cookie and creates one row, returning visit creates none, tampered signature yields a new player, Max-Age = 2592000
- [x] 7.3 Implement `CsrfProtection` with `csrf-csrf` `doubleCsrf` (secret from config, session identifier = `req.player.id`, header `X-CSRF-Token`, ignored GET/HEAD/OPTIONS, cookie `inv.csrf` / `__Host-inv.csrf` with hardened flags); verify tests using a test-only POST route: valid token passes, missing token → 403 `CSRF_INVALID`, token from another player's session → 403, production cookie uses `__Host-` prefix with `Secure`

## 8. Services, controllers, server & container

- [x] 8.1 Implement `HealthService` (DB `ping`, uptime) and `HealthController` (`GET /api/health` → 200 `ok` / 503 `degraded`); verify tests for both states and that no session cookie is set
- [x] 8.2 Implement `SessionController` (`GET /api/session` → `{ playerId, createdAt }` only) and `CsrfController` (`GET /api/csrf-token` → `{ csrfToken }`); verify responses validate against shared DTO schemas
- [x] 8.3 Implement `ApiServer` assembling middleware in the exact order of design §4 and exposing `listen()` / `close()`; verify by an ordering test that `/api/health` creates no player row and a rejected-by-CORS-or-rate-limit request does not touch the DB
- [x] 8.4 Implement `Container` (config → logger → database → repositories → services → middleware/controllers → ApiServer, with overrides for tests) and `test/createTestApp.ts` (in-memory DB, fixed 32+ char secrets, low rate limits optional); verify all existing tests use it
- [x] 8.5 Implement `src/main.ts` (load config with fail-fast printing all issues and exit 1, build container, listen, SIGTERM/SIGINT graceful shutdown with timeout → exit 0 or 1); verify manually: missing `COOKIE_SECRET` exits 1 naming the key, and `kill -TERM` on a running server exits 0

## 9. End-to-end verification & docs

- [x] 9.1 Add an end-to-end Supertest flow using a cookie agent: `GET /api/session` → `GET /api/csrf-token` → test POST with token succeeds → same POST without token 403; verify it passes in `pnpm test`
- [x] 9.2 Write `README.md` (prerequisites: Node ≥22.12, pnpm 10, Xcode CLT for better-sqlite3; setup with `.env` secrets; `pnpm dev`/`test`/`build`/`db:*`; architecture layering controller → service → repository; security overview and the web-client CSRF contract; the `development` export condition); verify instructions by running them on a clean clone
- [x] 9.3 Run full gate: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then `pnpm dev` and `curl -i localhost:3001/api/health` returns 200 with security headers; record the result
