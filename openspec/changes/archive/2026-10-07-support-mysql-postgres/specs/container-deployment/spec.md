# Spec Delta

## ADDED Requirements

### Requirement: Optional database server stacks
The repository SHALL provide Compose override files, `docker-compose.postgres.yml` and `docker-compose.mysql.yml`. Each one adds a database server container on its own named volume and points the `api` service at it. The `api` service MUST NOT start until that database is healthy. Without an override, the stack MUST keep using SQLite on its named volume.

#### Scenario: Run against PostgreSQL
- **WHEN** a user runs `docker compose -f docker-compose.yml -f docker-compose.postgres.yml up --build` with a valid `.env`
- **THEN** a PostgreSQL container starts, the `api` service becomes healthy using PostgreSQL, and the game is playable at `http://localhost:8080`

#### Scenario: Run against MySQL
- **WHEN** a user runs `docker compose -f docker-compose.yml -f docker-compose.mysql.yml up --build` with a valid `.env`
- **THEN** a MySQL container starts, the `api` service becomes healthy using MySQL, and the game is playable at `http://localhost:8080`

#### Scenario: Default stays SQLite
- **WHEN** a user runs `docker compose up --build` with no override file
- **THEN** no database server container starts and the `api` service stores its data in SQLite on the `game-data` volume

#### Scenario: Database port not published
- **WHEN** the stack runs with either override file
- **THEN** the database server's port is not bound on the host

#### Scenario: Data survives a rebuild
- **WHEN** a player starts a game on the PostgreSQL stack, then the stack is stopped, rebuilt and started again with the same volumes
- **THEN** the player's game is still listed for the same player cookie
