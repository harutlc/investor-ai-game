## MODIFIED Requirements

### Requirement: Environment overrides
The system SHALL let selected environment variables override values from the config file: at least `PORT`, `CORS_ORIGINS` (comma-separated), `DATABASE_FILE`, `LOG_LEVEL`, `LOG_LLM_CONTENT`, `NODE_ENV` and `TRUST_PROXY`. An environment value MUST win over the file value.

`LOG_LEVEL` is optional both in the environment and in the config file. When it is set in neither, the log level is the default for the environment (see api-foundation, "Structured logging with redaction").

`LOG_LLM_CONTENT` overrides `logging.llmContent`. It accepts `true` or `false`, and any other value MUST be rejected at startup. It defaults to `false`.

`TRUST_PROXY` overrides `server.trustProxy`. It accepts:
- `false`, which trusts no proxy;
- a positive integer, which is a hop count;
- a comma-separated list of proxy addresses or CIDRs.

`true` MUST be rejected at startup, as it is in the config file. Trusting every hop would let any client spoof its IP and get around per-IP rate limits.

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
