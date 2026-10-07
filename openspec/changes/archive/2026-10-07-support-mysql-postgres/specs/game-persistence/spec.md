# Spec Delta

## MODIFIED Requirements

### Requirement: Schema migration
The storage schema for game data SHALL be created automatically when the API starts, through migrations for the selected database dialect (`sqlite`, `postgres` or `mysql`). On an existing database, migrations only add tables or columns. Existing player records MUST be preserved. Starting against an empty database of any supported dialect MUST create the complete schema.

#### Scenario: Upgrade an existing database
- **WHEN** the API starts against a database created before this change, containing players
- **THEN** the game tables are created and every existing player is still present

#### Scenario: Existing SQLite database after this change
- **WHEN** the API starts with the default `sqlite` dialect against a database file written by the previous release, containing players and games
- **THEN** it starts without errors, and every player, game, message, offer and decision log entry is still present and listed in the same order

#### Scenario: Empty server database
- **WHEN** the API starts with `DATABASE_DIALECT=postgres` (or `mysql`) against an empty database
- **THEN** it creates every table, and a second start applies no further migrations
