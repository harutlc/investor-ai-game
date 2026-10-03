# player-session Specification

## Purpose

Gives every browser a persistent, anonymous player identity without accounts. Future resources such as games can then be owned by, and restricted to, the player who created them.

## Requirements

### Requirement: Anonymous player issuance
The system SHALL ensure every API request (except the health endpoint) has a player identity. When a request carries no valid player cookie, the system MUST create a new player record with a server-generated random UUID and set a signed player cookie containing that ID. Clients MUST NOT be able to choose or forge their player ID.

#### Scenario: First visit
- **WHEN** a client without cookies calls `GET /api/session`
- **THEN** a new player is stored, the response sets a signed `HttpOnly` player cookie, and the body contains `{ "playerId": "<uuid>", "createdAt": "<ISO-8601>" }`

#### Scenario: Returning visit
- **WHEN** a client sends a valid signed player cookie
- **THEN** the request is attributed to the existing player and no new player is created

#### Scenario: Tampered cookie
- **WHEN** a client sends a player cookie whose signature does not verify
- **THEN** the cookie is ignored, a new player is issued, and the forged ID is never used

#### Scenario: Unknown player ID
- **WHEN** a client sends a correctly signed cookie whose player no longer exists in storage
- **THEN** a new player is issued and the cookie is replaced

### Requirement: Player persistence
The system SHALL store players persistently with at least an `id`, a `createdAt` timestamp and a `lastSeenAt` timestamp. `lastSeenAt` MUST be updated at most once per minute per player, to limit write load.

#### Scenario: Last seen updated
- **WHEN** an existing player makes a request more than one minute after their `lastSeenAt`
- **THEN** their `lastSeenAt` is updated to the current time

### Requirement: Session lifetime
The player cookie SHALL have a configurable max age (30 days by default). The expiry MUST be refreshed when the cookie is re-issued.

#### Scenario: Cookie max age
- **WHEN** the player cookie is set with default config
- **THEN** its `Max-Age` is 2592000 seconds

### Requirement: Session endpoint
The system SHALL expose `GET /api/session`, which returns the current player's public data (`playerId`, `createdAt`) and nothing else.

#### Scenario: Public fields only
- **WHEN** a client calls `GET /api/session`
- **THEN** the response contains only `playerId` and `createdAt`
