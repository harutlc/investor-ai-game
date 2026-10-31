# database-backends Specification

## Purpose

Lets operators choose where the API stores its data (an SQLite file, a PostgreSQL server or a MySQL server) and guarantees that the game behaves the same whichever backend is chosen.

## Requirements

### Requirement: Dialect selection
The system SHALL store its data in exactly one database, chosen by the configured dialect: `sqlite`, `postgres` or `mysql`. When no dialect is configured, it MUST use `sqlite` with the configured database file, so existing setups keep working unchanged.

#### Scenario: Default is SQLite
- **WHEN** the API starts with no dialect configured and `database.file` set to `./data/game.sqlite`
- **THEN** it stores its data in that SQLite file

#### Scenario: PostgreSQL selected
- **WHEN** the API starts with `DATABASE_DIALECT=postgres` and a reachable `DATABASE_URL` of the form `postgres://…`
- **THEN** it stores players and games in that PostgreSQL database and creates no SQLite file

#### Scenario: MySQL selected
- **WHEN** the API starts with `DATABASE_DIALECT=mysql` and a reachable `DATABASE_URL` of the form `mysql://…`
- **THEN** it stores players and games in that MySQL database and creates no SQLite file

### Requirement: Supported server versions
The system SHALL support PostgreSQL 14 or later and MySQL 8.0 or later. Other MySQL-compatible servers (such as MariaDB) are not supported.

#### Scenario: Oldest supported versions
- **WHEN** the persistence test suite runs against PostgreSQL 14 and against MySQL 8.0
- **THEN** every test passes on both

### Requirement: Startup connection check
For `postgres` and `mysql`, the system SHALL connect to the database and apply pending migrations before it accepts HTTP requests. If either step fails, the process MUST exit with a non-zero code and log the reason. The log MUST NOT contain the database password.

#### Scenario: Server unreachable
- **WHEN** the API starts with `DATABASE_DIALECT=postgres` and a `DATABASE_URL` pointing at a host where nothing is listening
- **THEN** the process exits with a non-zero code, no port is opened, and the log names the database host but not the password

#### Scenario: Wrong credentials
- **WHEN** the API starts with `DATABASE_DIALECT=mysql` and a `DATABASE_URL` with a wrong password
- **THEN** the process exits with a non-zero code and the log does not contain the password

### Requirement: Same behavior on every backend
Every game-persistence and player-session requirement SHALL hold on each supported dialect. This includes ownership scoping, ordering of same-millisecond inserts, the optimistic turn check, transactional turns, cascade deletes, foreign-key enforcement and lossless round-trips of structured data, timestamps and amounts.

#### Scenario: Same transcript order everywhere
- **WHEN** three messages are added to a session within the same millisecond, on SQLite, PostgreSQL and MySQL in turn
- **THEN** each backend lists them in insertion order

#### Scenario: Large amounts round-trip
- **WHEN** an offer with an implied valuation of €5,000,000,000 is stored and read back on any dialect
- **THEN** the same value is returned

#### Scenario: Millisecond timestamps
- **WHEN** a session created at `2026-10-07T12:00:00.123Z` is read back on any dialect
- **THEN** its creation time is exactly `2026-10-07T12:00:00.123Z`

#### Scenario: Failed turn leaves no trace
- **WHEN** a turn's save fails part-way through on any dialect
- **THEN** none of that turn's messages, offers or session changes are stored

### Requirement: Connection lifecycle
The system SHALL keep its database connections open for the life of the process and MUST close them during graceful shutdown. While the database cannot answer a trivial query, the health endpoint MUST report `checks.database = "error"`.

#### Scenario: Database goes away
- **WHEN** the PostgreSQL server stops while the API is running
- **THEN** `GET /api/health` returns 503 with `checks.database = "error"`, and returns 200 again once the server is back

#### Scenario: Shutdown closes connections
- **WHEN** the API receives SIGTERM while connected to MySQL
- **THEN** it closes its database connections before exiting with code 0
