## Why

The API can only store its data in SQLite: one file, opened by one process. Teams that already run PostgreSQL or MySQL (managed RDS/Aurora, Cloud SQL, a shared database server) cannot point the game at it. They also cannot use their usual tooling for backups, replication and inspection. Supporting both server databases lets operators pick the backend that fits where the game runs, while SQLite stays the zero-setup default for local development and the existing deployments.

## What Changes

- Add a database dialect setting, `database.dialect` (`sqlite` | `postgres` | `mysql`, default `sqlite`), overridable with `DATABASE_DIALECT`.
- For `postgres` and `mysql`, read the connection string from a new secret environment variable, `DATABASE_URL`. It is never read from the committed config file and never printed. `database.file` / `DATABASE_FILE` still apply to `sqlite` only.
- Validate at startup: `DATABASE_URL` is required for a server dialect, and its scheme must match the dialect. The API refuses to start (non-zero exit, password redacted) when the server cannot be reached or migrations fail.
- Keep one logical schema (players, game sessions, messages, offers, decision logs) and give each dialect its own migrations. Each dialect gets native types where they matter: JSON/JSONB for structured columns, millisecond timestamps and 64-bit integers for money.
- Every game-persistence guarantee holds on all three backends: ownership scoping, ordering (including same-millisecond inserts), the optimistic turn check, transactions, cascade deletes, foreign-key enforcement and the health check. Ordering currently relies on SQLite's `rowid`; it moves to a portable insertion-order column on the server dialects.
- **BREAKING (internal):** the data-access layer becomes asynchronous, because the PostgreSQL and MySQL drivers are async-only. Repositories return promises, transactions take an async callback, and the database is opened asynchronously at startup. No HTTP API or UI behavior changes.
- Add Compose override files (`docker-compose.postgres.yml`, `docker-compose.mysql.yml`) that run the local stack against a real server, plus `docker-compose.test-db.yml` for the test suite. The default `docker compose up` stays SQLite-only.
- Run the persistence test suite against every dialect: SQLite always, PostgreSQL and MySQL when a test database URL is provided.
- Document dialect selection, supported server versions (PostgreSQL ≥ 14, MySQL ≥ 8.0) and the new variables in the README.

**Non-goals:** copying existing SQLite data into PostgreSQL/MySQL; running more than one API replica (the in-process turn lock and rate limiter still assume one process); changing the AWS deployment, which stays on SQLite.

## Capabilities

### New Capabilities
- `database-backends`: How the API chooses and connects to its database (SQLite, PostgreSQL or MySQL), which server versions it supports, how connection failures are handled, and the guarantee that game data behaves the same on every backend.

### Modified Capabilities
- `app-config`: adds `DATABASE_DIALECT` to the environment overrides and `DATABASE_URL` as a secret, and makes `DATABASE_URL` conditionally required.
- `game-persistence`: schema migration applies to the selected dialect, not only to SQLite.
- `container-deployment`: adds opt-in Compose override files that run the API against a PostgreSQL or MySQL container; the default SQLite volume behavior is unchanged.

## Impact

- **Code (`apps/api`):** `src/db/` (dialect adapters, per-dialect schemas and migrations, async `Database`), all five repositories, `GameEngine` transactions, `GameSessionService`, `PlayerService`, the player-session middleware, `HealthService`, `Container`/`main.ts` startup and shutdown, `config/AppConfigSchema.ts` and `ConfigLoader.ts`, and `drizzle.config.ts` (one config per dialect).
- **Tests:** repository, database, engine and service tests become async. Persistence tests are parameterized by dialect.
- **Dependencies:** adds `pg` and `mysql2` (with `@types/pg`). `drizzle-orm` and `drizzle-kit` already support both.
- **Ops:** new `docker-compose.{postgres,mysql,test-db}.yml` files (the base `docker-compose.yml` only pins `DATABASE_DIALECT: sqlite`); `.env.example` and the README document `DATABASE_DIALECT` and `DATABASE_URL`. `docker-compose.aws.yml`, `infra/aws` and the Dockerfile's SQLite path are unchanged.
- **Existing data:** SQLite databases upgrade in place with no data loss. Switching dialects starts from an empty database.
