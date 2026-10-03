# app-config Specification

## Purpose

Gives the API one validated, typed source of configuration. It combines a committed, non-secret config file with secrets and overrides from the environment, and refuses to start when the configuration is invalid.

## Requirements

### Requirement: Configuration sources
The system SHALL load non-secret settings from a committed JSON config file (`config/app.config.json`) and secrets from environment variables, which can optionally come from a git-ignored `.env` file. Secrets (cookie and CSRF signing secrets, API keys) MUST NOT be read from the committed config file.

#### Scenario: Settings come from the config file
- **WHEN** the API starts with a valid config file that sets the server port to 3001
- **THEN** the API listens on port 3001

#### Scenario: Secrets come from the environment
- **WHEN** `COOKIE_SECRET` and `CSRF_SECRET` are set in the environment
- **THEN** the API uses them to sign cookies and CSRF tokens

### Requirement: Environment overrides
The system SHALL let selected environment variables override values from the config file: at least `PORT`, `CORS_ORIGINS` (comma-separated), `DATABASE_FILE`, `LOG_LEVEL` and `NODE_ENV`. An environment value MUST win over the file value.

#### Scenario: Port override
- **WHEN** the config file sets the port to 3001 and the environment sets `PORT=4000`
- **THEN** the API listens on port 4000

#### Scenario: CORS origins override
- **WHEN** the environment sets `CORS_ORIGINS=https://a.example,https://b.example`
- **THEN** exactly those two origins are allowed and the file's origin list is ignored

### Requirement: Validation and fail-fast startup
The system SHALL validate the merged configuration against a schema before it opens any port or database connection. When validation fails, the process MUST exit with a non-zero code and print a message that names every invalid or missing key. The message MUST NOT print secret values.

#### Scenario: Missing secret
- **WHEN** the API starts without `COOKIE_SECRET`
- **THEN** startup aborts with a non-zero exit code and a message naming `COOKIE_SECRET` as missing

#### Scenario: Weak secret
- **WHEN** `CSRF_SECRET` is shorter than 32 characters
- **THEN** startup aborts with a message saying `CSRF_SECRET` must be at least 32 characters, without printing its value

#### Scenario: Invalid value in the file
- **WHEN** the config file sets the server port to `"abc"`
- **THEN** startup aborts with a message naming `server.port` as invalid

### Requirement: Read-only typed access
The system SHALL expose the validated configuration to the rest of the application as an immutable object. Application code MUST NOT be able to change configuration at runtime.

#### Scenario: Mutation attempt
- **WHEN** application code tries to assign a new value to a configuration property
- **THEN** the value stays unchanged (the assignment throws in strict mode)
