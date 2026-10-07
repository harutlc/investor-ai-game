# Design

## Context

Persistence lives in `apps/api/src/db/` and `apps/api/src/repositories/`. It is built on Drizzle ORM (`drizzle-orm` 0.45, `drizzle-kit` 0.31) and `better-sqlite3`:

- `Database` opens the file, sets `journal_mode = WAL` and `foreign_keys = ON`, and runs the Drizzle migrator from `src/db/migrations` (3 SQL migrations plus `meta/_journal.json`). It exposes `transaction(fn)`, where `fn` **must be synchronous**, and a synchronous `ping()`.
- `schema.ts` uses `sqliteTable`. JSON is stored as `text({ mode: 'json' })`, timestamps as `integer({ mode: 'timestamp_ms' })`, money as `integer` and equity as `real`.
- The five repositories are **synchronous** (`.get()`, `.all()`, `.run()`). They rely on SQLite specifics:
  - `sql\`rowid\`` as the tie-breaker for insertion order (messages, offers, decision logs, session listing);
  - `result.changes` for the optimistic `expectedTurn` update.
- Callers: `GameEngine` (two `database.transaction(() => …)` blocks), `GameSessionService`, `MoveResolver`/`DecisionLogger`, `PlayerService` (used by `PlayerSessionMiddleware`), and `HealthService` (`ping`). `Container` builds `Database` synchronously in its constructor, and `main.ts` calls `new Container(config)`.
- Config: `database: { file }` in `AppConfigSchema` (strict object), with the `DATABASE_FILE` override in `ConfigLoader`.
- Tests construct `new Database(':memory:')` in about 12 files. Some reach into `database.sqlite` for raw SQL.

The PostgreSQL (`pg`) and MySQL (`mysql2`) drivers are async-only, so the synchronous repository contract cannot be kept.

## Goals / Non-Goals

**Goals:**
- One repository implementation, shared by all three dialects. Dialect differences stay inside `src/db/`.
- Existing SQLite files keep working with no manual step.
- The persistence test suite is the proof of "same behavior on every backend" (see `specs/database-backends`).

**Non-Goals:**
- Multi-replica safety. `TurnLock` and the rate limiter stay in-process, so one API process per database is still required.
- A SQLite → server data copy tool.
- Read replicas, TLS options beyond what the URL carries (e.g. `?sslmode=require`), or pool tuning beyond a single `database.poolMax`.

## Decisions

### 1. Async repositories, with transactions bound through `AsyncLocalStorage`
Every repository method returns a `Promise`. `Database.transaction(fn: () => Promise<T>)` opens a transaction and stores its handle in an `AsyncLocalStorage`. Repositories get their query executor from `database.executor()`, which returns the active transaction if there is one and the root db otherwise. The `GameEngine` bodies only gain `async`/`await`; repositories keep their constructors and need no `tx` parameter threaded through.

*Alternatives:* pass `tx` explicitly to each repository call (noisy, easy to forget, and a forgotten `tx` silently runs outside the transaction on a pool); keep sync repositories for SQLite only (two contracts, so every caller would branch).

### 2. SQLite keeps `better-sqlite3`, with all access serialized
Drizzle's better-sqlite3 transactions are synchronous, and the app has one shared connection. The SQLite adapter therefore runs every operation through an in-process async mutex. `transaction` takes the mutex for its whole body (`BEGIN IMMEDIATE` … `COMMIT`/`ROLLBACK`), and operations inside that transaction (recognised through the ALS context) bypass it. This prevents another request's write from slipping into, or being rolled back with, an open transaction on the shared connection.

*Alternatives:* switch SQLite to `@libsql/client` (async, but a new native dependency with different file locking semantics); open a second SQLite connection per transaction (WAL allows only one writer anyway, and errors become `SQLITE_BUSY` timeouts instead of queueing).

### 3. Per-dialect schema files with identical shapes; repositories pick tables at runtime
`src/db/schema/{sqlite,postgres,mysql}.ts` define the same tables with the same TypeScript property names. A `DialectAdapter` (`src/db/dialects/*`) bundles:
- the Drizzle db;
- its `tables`;
- an `insertionOrder(table)` column for tie-breaking;
- `affectedRows(result)`;
- `ping()`, `close()` and `migrate()`.

Repositories use `this.database.tables.messages` and so on. For type checking, the db is exposed as one `GameDb` type alias (a single documented cast in `Database.ts`), and repositories only use builder features common to all three dialects:
- `await` a query to get an array, and use `.limit(1)` plus `[0]` in place of `.get()`;
- no `.returning()`, which MySQL lacks;
- no `onConflict…`.

A test asserts that the three schema files expose the same table and column property names.

*Alternatives:* three repository sets (3× the code to keep in sync); move to Kysely or Prisma (a rewrite of every query and the migration history).

### 4. Column mapping

| Logical | SQLite (unchanged) | PostgreSQL | MySQL |
|---|---|---|---|
| ids (UUID) | `text` PK | `text` PK | `varchar(36)` PK |
| enums/short strings | `text` | `text` | `varchar(64)` (`provider`/`model`: `varchar(128)`) |
| chat text, pitch fields | `text` | `text` | `text` |
| JSON columns | `text` json mode | `jsonb` | `json` |
| timestamps | `integer` timestamp_ms | `timestamp(3) with time zone` | `datetime(3)` (connection `timezone: 'Z'`) |
| money (`investment`, `implied_valuation`) | `integer` | `bigint` (mode number) | `bigint` (mode number) |
| `equity` | `real` | `double precision` | `double` |
| insertion order | implicit `rowid` | `seq bigint generated always as identity` | `seq bigint unsigned auto_increment unique` (`serial`) |

`player_options` has no database default on the server dialects. Repositories always write it, and the `'[]'` default only existed to upgrade old SQLite rows. JSONB and MySQL JSON may reorder object keys. This is harmless, because every JSON column is parsed with its zod schema on read and compared by value in tests.

### 5. Migrations: one folder and one drizzle-kit config per dialect
- `src/db/migrations/sqlite/`: the existing three migrations and `meta/` moved here unchanged. The Drizzle migrator matches applied migrations by their journal timestamps, not by folder, so existing files upgrade as no-ops.
- `src/db/migrations/postgres/` and `src/db/migrations/mysql/`: each starts with one generated `0000` baseline of the full current schema.
- `drizzle.{sqlite,postgres,mysql}.config.ts`, plus `db:generate` running all three. A schema change from now on means editing three schema files and generating three migrations. A test fails if the three schemas drift apart (Decision 3).

### 6. Configuration
`database` becomes:

```
{ dialect: 'sqlite' | 'postgres' | 'mysql' = 'sqlite', file: string, poolMax: int = 10 }
```

Only the `sqlite` dialect needs `file`. `DATABASE_DIALECT` overrides `dialect`. `DATABASE_URL` is read into `secrets.databaseUrl`, like the other secrets. A second-pass check (the same mechanism used for `CSRF_SECRET` and the provider keys) requires it for a server dialect and checks its scheme. Messages print the dialect and the host, never the URL. Pino redaction gains `databaseUrl`.

### 7. Async startup
`Database.open(options): Promise<Database>` connects, pings and migrates. `Container.create(config): Promise<Container>` replaces `new Container(config)`, so `main.ts` awaits it, and a failure there goes through the existing fatal-log-then-exit path. Driver errors are wrapped in a `DatabaseConnectionError` that carries `dialect` and `host`, with the password stripped. `dispose()` becomes async and awaits `pool.end()`.

### 7a. Turn lock before the first await
`playTurn` used to load the session and take the in-process `TurnLock` with no await in between. Loading is now async, so the lock is taken first, keyed by `playerId/gameId`, and the status is checked after the load. Keying by player means a request for someone else's game id can never block that game's owner.

### 8. Tests
`test/support/testDatabase.ts` exports `dialectsUnderTest()`. It always includes `sqlite` (`:memory:`), adds `postgres` when `TEST_POSTGRES_URL` is set and `mysql` when `TEST_MYSQL_URL` is set. `openTestDatabase(dialect)` creates a uniquely named database (`investor_test_<random>`) on the server, migrates it, and drops it in `close()`. Persistence-heavy suites (repositories, `Database`, `GameEngine`/`GameSessionService`, `DecisionLogger`) use `describe.each(dialectsUnderTest())`. Raw SQL in tests (`database.sqlite.prepare`) moves to a dialect-neutral helper or stays SQLite-only where it tests SQLite upgrade behavior.

### 9. Compose override files, not profiles
`docker-compose.postgres.yml` adds a `postgres` service (`postgres:16-alpine`) and `docker-compose.mysql.yml` adds a `mysql` service (`mysql:8.4`). Each service has a named volume, a healthcheck and no host port. Each file also overrides `api` with `DATABASE_DIALECT`, a `DATABASE_URL` that points at the in-network service, and `depends_on: { <db>: { condition: service_healthy } }`. The local password comes from `.env` (`DOCKER_DB_PASSWORD`) and defaults to a dev-only value. The base `docker-compose.yml` only gains `DATABASE_DIALECT: sqlite` under `api.environment`, so a `DATABASE_DIALECT` in a local `.env` cannot switch the default stack away from SQLite.

*Alternative:* Compose profiles. A profile can add a service, but it cannot change another service's environment, so `api` would still need the dialect and URL set by hand in `.env`.

For tests, `docker-compose.test-db.yml` starts both servers with host ports bound to `127.0.0.1` (5432/3306) for `TEST_POSTGRES_URL` and `TEST_MYSQL_URL`.

## Risks / Trade-offs

- [The sync → async refactor touches every persistence caller, and a missed `await` silently drops a write] → `@typescript-eslint/no-floating-promises` (already enabled repo-wide) flags it; the existing behavior tests, now async, catch ordering mistakes.
- [The SQLite mutex serializes all DB access, so throughput is lower than today's sync calls] → the operations take microseconds and are already effectively serialized on one connection; transactions contain no network calls (LLM calls happen before `save`).
- [Schemas drift between dialects] → the structural parity test (Decision 3) plus running the full persistence suite per dialect.
- [MySQL `datetime` has no time zone, so a non-UTC session time zone shifts timestamps] → the connection sets `timezone: 'Z'`; covered by the millisecond-timestamp scenario.
- [The reserved word `from` (offers column) on MySQL/PostgreSQL] → Drizzle always quotes identifiers; covered by the offers tests on each dialect.
- [Pool exhaustion under a slow database] → `poolMax` is bounded, and the health check uses its own short timeout so `/api/health` still answers.
- [Server dialects are only tested when a developer provides URLs, since there is no CI] → the README documents `docker compose -f docker-compose.test-db.yml up -d` followed by `pnpm test` with the URLs; the tasks require one full green run on each dialect before archiving.

## Migration Plan

1. Ship with the default `sqlite` dialect. Existing deployments (local Compose, AWS) need no change. On startup the migrator finds the moved SQLite migrations already applied.
2. To move to PostgreSQL/MySQL: provision an empty database, set `DATABASE_DIALECT` and `DATABASE_URL`, and start. The schema is created automatically. Existing SQLite data is **not** copied (proposal non-goal).
3. Rollback: unset `DATABASE_DIALECT` (back to SQLite), or redeploy the previous image. The SQLite file is untouched by this change, so a rollback loses nothing stored in SQLite.

## Open Questions

- Should the AWS deployment later move to RDS PostgreSQL? This would be a separate change to `aws-deployment`. This design does not block it.
