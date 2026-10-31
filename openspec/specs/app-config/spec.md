# app-config Specification

## Purpose

Gives the API one validated, typed source of configuration. It combines a committed, non-secret config file with secrets and overrides from the environment, and refuses to start when the configuration is invalid.

## Requirements

### Requirement: Configuration sources
The system SHALL load non-secret settings from a committed JSON config file (`config/app.config.json`) and secrets from environment variables, which can optionally come from a git-ignored `.env` file. Secrets (cookie and CSRF signing secrets, API keys and the database connection string `DATABASE_URL`) MUST NOT be read from the committed config file.

#### Scenario: Settings come from the config file
- **WHEN** the API starts with a valid config file that sets the server port to 3001
- **THEN** the API listens on port 3001

#### Scenario: Secrets come from the environment
- **WHEN** `COOKIE_SECRET` and `CSRF_SECRET` are set in the environment
- **THEN** the API uses them to sign cookies and CSRF tokens

#### Scenario: Database URL only from the environment
- **WHEN** the committed config file contains a `database.url` key
- **THEN** startup aborts with a message naming `database.url` as an unknown key, and the connection string is read only from `DATABASE_URL`

### Requirement: Environment overrides
The system SHALL let selected environment variables override values from the config file: at least `PORT`, `CORS_ORIGINS` (comma-separated), `DATABASE_DIALECT`, `DATABASE_FILE`, `LOG_LEVEL`, `LOG_LLM_CONTENT`, `NODE_ENV` and `TRUST_PROXY`. An environment value MUST win over the file value.

`LOG_LEVEL` is optional both in the environment and in the config file. When it is set in neither, the log level is the default for the environment (see api-foundation, "Structured logging with redaction").

`LOG_LLM_CONTENT` overrides `logging.llmContent`. It accepts `true` or `false`, and any other value MUST be rejected at startup. It defaults to `false`.

`TRUST_PROXY` overrides `server.trustProxy`. It accepts:
- `false`, which trusts no proxy;
- a positive integer, which is a hop count;
- a comma-separated list of proxy addresses or CIDRs.

`true` MUST be rejected at startup, as it is in the config file. Trusting every hop would let any client spoof its IP and get around per-IP rate limits.

`DATABASE_DIALECT` overrides `database.dialect`. It accepts `sqlite`, `postgres` or `mysql`, and any other value MUST be rejected at startup.

#### Scenario: Port override
- **WHEN** the config file sets the port to 3001 and the environment sets `PORT=4000`
- **THEN** the API listens on port 4000

#### Scenario: CORS origins override
- **WHEN** the environment sets `CORS_ORIGINS=https://a.example,https://b.example`
- **THEN** exactly those two origins are allowed and the file's origin list is ignored

#### Scenario: Trust proxy hop count
- **WHEN** the config file sets `server.trustProxy` to `false` and the environment sets `TRUST_PROXY=1`
- **THEN** the API trusts one proxy hop and takes the client IP from the `X-Forwarded-For` value that proxy appended

#### Scenario: Trust proxy address list
- **WHEN** the environment sets `TRUST_PROXY=10.0.0.0/8,172.16.0.0/12`
- **THEN** the API trusts exactly those two ranges as proxies

#### Scenario: Trust proxy disabled
- **WHEN** the environment sets `TRUST_PROXY=false`
- **THEN** the API trusts no proxy and ignores `X-Forwarded-For` when it picks the client IP

#### Scenario: Trust-all is refused
- **WHEN** the environment sets `TRUST_PROXY=true`
- **THEN** startup aborts with a non-zero exit code and a message that names `server.trustProxy (from TRUST_PROXY)`

#### Scenario: LLM content logging enabled
- **WHEN** the environment sets `LOG_LLM_CONTENT=true`
- **THEN** LLM log lines include the prompt and response content

#### Scenario: Invalid LLM content flag
- **WHEN** the environment sets `LOG_LLM_CONTENT=yes`
- **THEN** startup aborts with a non-zero exit code and a message that names `logging.llmContent (from LOG_LLM_CONTENT)`

#### Scenario: Dialect override
- **WHEN** the config file leaves `database.dialect` unset and the environment sets `DATABASE_DIALECT=postgres`
- **THEN** the API uses PostgreSQL

#### Scenario: Invalid dialect
- **WHEN** the environment sets `DATABASE_DIALECT=oracle`
- **THEN** startup aborts with a non-zero exit code and a message that names `database.dialect (from DATABASE_DIALECT)`

### Requirement: Validation and fail-fast startup
The system SHALL validate the merged configuration against a schema before it opens any port or database connection. When validation fails, the process MUST exit with a non-zero code and print a message that names every invalid or missing key. Keys that are required only conditionally (for example `CSRF_SECRET` while CSRF protection is enabled, or the active provider's API key) MAY be reported in a second pass, once the other problems are fixed. The message MUST NOT print secret values.

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

### Requirement: Database connection settings
The system SHALL require `DATABASE_URL` when the dialect is `postgres` or `mysql`, and its scheme MUST match the dialect (`postgres://` or `postgresql://` for `postgres`, `mysql://` for `mysql`). For `sqlite` it MUST ignore `DATABASE_URL` and use `database.file`. Validation messages MUST NOT print the URL or its password.

#### Scenario: Missing URL for a server dialect
- **WHEN** the API starts with `DATABASE_DIALECT=mysql` and no `DATABASE_URL`
- **THEN** startup aborts with a non-zero exit code and a message naming `DATABASE_URL` as missing

#### Scenario: Scheme does not match the dialect
- **WHEN** the API starts with `DATABASE_DIALECT=postgres` and `DATABASE_URL=mysql://game:s3cret@db/game`
- **THEN** startup aborts with a message saying `DATABASE_URL` must be a PostgreSQL URL, and the message does not contain `s3cret`

#### Scenario: URL ignored for SQLite
- **WHEN** the dialect is `sqlite` and `DATABASE_URL` is set
- **THEN** the API starts and stores its data in the `database.file` SQLite file
