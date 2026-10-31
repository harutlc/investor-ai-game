# Tasks

## 1. Dependencies and lint guard

- [x] 1.1 Add `pg` and `mysql2` to `apps/api` dependencies and `@types/pg` to devDependencies; verify `pnpm install` and `pnpm --filter @investor/api typecheck` succeed
- [x] 1.2 Enable `@typescript-eslint/no-floating-promises` for `apps/api/src` in `eslint.config.js` (design §Risks); verify `pnpm lint` reports no violations on the current code

## 2. Configuration (specs: app-config)

- [x] 2.1 Extend `AppConfigSchema` `database` to `{ dialect: 'sqlite'|'postgres'|'mysql' = 'sqlite', file, poolMax = 10 }` and add `secrets.databaseUrl`; verify a ConfigLoader test that the default config still yields `dialect: 'sqlite'` and an unknown `database.url` key in the file is rejected by name
- [x] 2.2 Add the `DATABASE_DIALECT` override and read `DATABASE_URL` into `secrets.databaseUrl` in `ConfigLoader`; verify tests for the "Dialect override" and "Invalid dialect" scenarios (message names `database.dialect (from DATABASE_DIALECT)`)
- [x] 2.3 Add the second-pass check: `DATABASE_URL` required for `postgres`/`mysql`, scheme must match, ignored for `sqlite`, and no URL or password in messages; verify tests for "Missing URL for a server dialect", "Scheme does not match the dialect" (message lacks `s3cret`) and "URL ignored for SQLite"
- [x] 2.4 Add `databaseUrl` to the pino redaction paths; verify a logger test that a logged config object shows the URL as redacted
- [x] 2.5 Document `DATABASE_DIALECT` and `DATABASE_URL` in `.env.example` and the README configuration table; verify both list the two variables with allowed values

## 3. Dialect adapters, schemas and migrations (specs: database-backends, game-persistence)

- [x] 3.1 Move `schema.ts` to `src/db/schema/sqlite.ts` unchanged, and the existing migrations and `meta/` to `src/db/migrations/sqlite/`; update `drizzle.config.ts` → `drizzle.sqlite.config.ts`; verify `drizzle-kit generate --config drizzle.sqlite.config.ts` reports no changes
- [x] 3.2 Write `src/db/schema/postgres.ts` and `src/db/schema/mysql.ts` per the column mapping in design §4 (including the `seq` insertion-order columns and no `player_options` default); verify a parity test that all three schemas expose identical table and column property names
- [x] 3.3 Add `drizzle.postgres.config.ts` and `drizzle.mysql.config.ts`, generate each `0000` baseline into `src/db/migrations/{postgres,mysql}/`, and make `db:generate` run all three configs; verify the generated SQL creates all five tables with their foreign keys (`restrict` on players, `cascade` on sessions) and indexes
- [x] 3.4 Implement the `DialectAdapter` interface and its SQLite adapter: better-sqlite3 with WAL and `foreign_keys`, an async mutex serializing all access, `BEGIN IMMEDIATE` transactions that bypass the mutex for in-transaction calls, `insertionOrder` = `rowid`, `affectedRows` = `changes` (design §2, §3); verify unit tests that a concurrent non-transaction write waits for an open transaction and is not rolled back with it
- [x] 3.5 Implement the PostgreSQL adapter (`pg` Pool with `poolMax`, `insertionOrder` = `seq`, `affectedRows` = `rowCount`) and the MySQL adapter (`mysql2` pool with `timezone: 'Z'`, `insertionOrder` = `seq`, `affectedRows` = `affectedRows`); verify `pnpm --filter @investor/api typecheck` passes and an adapter smoke test (ping, migrate, close) passes against `TEST_POSTGRES_URL` and `TEST_MYSQL_URL`
- [x] 3.6 Rewrite `Database` as `Database.open(options): Promise<Database>` with `executor()`, `tables`, `transaction(async fn)` bound through `AsyncLocalStorage`, async `ping()` and `close()`, and wrap connect/migrate failures in `DatabaseConnectionError` carrying dialect and host with the password stripped (design §1, §7); verify `test/db/Database.test.ts` (ported) passes for commit, rollback, ping-after-close and "Existing SQLite database after this change", which upgrades a file built with the moved migrations and keeps its rows
- [x] 3.7 Add `test/support/testDatabase.ts` with `dialectsUnderTest()` and `openTestDatabase(dialect)`, which creates and drops a uniquely named database per suite, and add `docker-compose.test-db.yml` (PostgreSQL 14 and MySQL 8.0 on `127.0.0.1`); verify `docker compose -f docker-compose.test-db.yml up -d` followed by the Database tests with both `TEST_*_URL` vars runs them on three dialects

## 4. Async repositories (specs: game-persistence, database-backends)

- [x] 4.1 Convert `PlayerRepository` to async over `database.executor()`/`tables` (no `.get()`/`.run()`/`.returning()`); verify `PlayerRepository.test.ts`, parameterized with `describe.each(dialectsUnderTest())`, passes
- [x] 4.2 Convert `GameSessionRepository`: ordering by `createdAt` then `insertionOrder`, and `update` returning `affectedRows > 0` under `expectedTurn`; verify the parameterized tests pass, including "Another player's session", "Own sessions listed newest first", "Options replaced" and an invalid-option write failing
- [x] 4.3 Convert `MessageRepository`, `OfferRepository` and `DecisionLogRepository` to async with `insertionOrder` tie-breaks; verify the parameterized tests pass, including "Ordered transcript" (same millisecond), "Latest investor offer" and the decision-log ordering
- [x] 4.4 Add cross-dialect round-trip tests for "Large amounts round-trip" (€5,000,000,000 valuation), "Millisecond timestamps" (`…12:00:00.123Z`), structured investor state, "Orphan rejected" and "Cascade delete"; verify they pass on every dialect under test

## 5. Callers and startup (specs: database-backends, api-foundation behavior unchanged)

- [x] 5.1 Make `PlayerService.resolveOrCreate` and `PlayerSessionMiddleware` async (await in the Express 5 handler); verify `PlayerService.test.ts` and the session API tests pass
- [x] 5.2 Update `GameSessionService`, `MoveResolver`/`DecisionLogger` and `GameEngine` to await repositories and use `await database.transaction(async () => …)` in `startGame` and `save`. Keep "load and lock with no await in between" in `playTurn` by acquiring the lock before the async load, then re-checking. Verify `GameSessionService`, `MoveResolver`, `DecisionLogger`, `InvestorBrain` and game API tests pass, plus a parameterized "Failed turn leaves no trace" test
- [x] 5.3 Make `HealthService` await `database.ping()` with a short timeout; verify the health tests pass and a test with a closed database returns 503 with `checks.database = "error"`
- [x] 5.4 Replace `new Container(config)` with `await Container.create(config)` and make `dispose()` async; in `main.ts`, log `DatabaseConnectionError` as fatal and exit non-zero before listening, and await `dispose()` on shutdown. Verify a startup test with `DATABASE_DIALECT=postgres` and an unreachable URL exits non-zero, opens no port, and logs the host but not the password
- [x] 5.5 Port the remaining tests that construct `new Database(':memory:')` or use `database.sqlite` to `openTestDatabase`/async helpers; verify `pnpm --filter @investor/api test` passes with no `TEST_*_URL` set (SQLite only) and `pnpm lint` reports no floating promises

## 6. Compose stacks and docs (specs: container-deployment)

- [x] 6.1 Add `docker-compose.postgres.yml` (`postgres:16-alpine`) and `docker-compose.mysql.yml` (`mysql:8.4`), each with a named volume, a healthcheck, no host port, `DOCKER_DB_PASSWORD`, and `api` overrides for `DATABASE_DIALECT`/`DATABASE_URL`/`depends_on: service_healthy`; verify `docker compose -f docker-compose.yml -f docker-compose.postgres.yml config` (and the mysql equivalent) is valid and shows no published DB port
- [x] 6.2 Verify "Run against PostgreSQL" and "Run against MySQL": bring up each stack with fake providers, play a turn at `http://localhost:8080`, restart with `--build`, and confirm the game is still listed; verify plain `docker compose up --build` still starts no DB container and uses `game-data`
- [x] 6.3 Add a README section "Choosing a database" covering dialects, supported versions (PostgreSQL ≥ 14, MySQL ≥ 8.0), the override files, running tests against servers, the absence of a SQLite → server data copy, and the single-replica limit; verify each documented command runs as written

## 7. Integration check

- [x] 7.1 Run the full API test suite with `TEST_POSTGRES_URL` and `TEST_MYSQL_URL` set against `docker-compose.test-db.yml` (PostgreSQL 14, MySQL 8.0); verify every test passes on all three dialects
- [x] 7.2 Start the API against an existing SQLite file from the previous release (copy of `data/game.sqlite`); verify it starts, the existing games load in the UI, and a new turn can be played
- [x] 7.3 Run `openspec validate support-mysql-postgres --strict`; verify it passes

## Workflow follow-up

- Archive the change with `/opsx:archive` after review; this syncs `database-backends` into `openspec/specs/` and applies the deltas to `app-config`, `game-persistence` and `container-deployment`.
