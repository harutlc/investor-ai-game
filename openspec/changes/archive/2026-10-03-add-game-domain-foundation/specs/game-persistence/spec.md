## Purpose

Stores everything a negotiation needs to survive between requests and restarts: the game sessions each player owns, their chat messages and offers, the investor's hidden state, and a log of every decision the investor's brain made.

## ADDED Requirements

### Requirement: Game sessions
The system SHALL store each game session persistently with at least: a server-generated UUID, the owning player's id, the persona id, an optional scenario id, the startup pitch, the status, the phase, the current turn number, the investor's current offer (if any), the investor's state, and created and updated timestamps. A game session MUST belong to an existing player.

#### Scenario: Create and read back
- **WHEN** a game session is created for an existing player and read back by id
- **THEN** every stored field is returned unchanged

#### Scenario: Unknown player
- **WHEN** a game session is created for a player id that does not exist
- **THEN** the write fails and no session is stored

### Requirement: Player ownership
The system SHALL look up a game session only together with the id of the player requesting it. A session MUST NOT be returned to a player who does not own it; to that player it MUST look the same as a session that does not exist.

#### Scenario: Another player's session
- **WHEN** player B looks up a session created by player A
- **THEN** nothing is returned, exactly as for an unknown session id

#### Scenario: Own sessions listed newest first
- **WHEN** a player who created two sessions lists their sessions
- **THEN** both are returned, the most recently created first, and no other player's sessions are included

### Requirement: Session updates
The system SHALL update a session's status, phase, turn, current investor offer and investor state together, and MUST refresh its updated timestamp on every update.

#### Scenario: Turn advances
- **WHEN** a session's turn, investor offer and investor state are updated
- **THEN** reading it back returns the new values and a later updated timestamp

### Requirement: Hidden investor state stays server-side
The investor's state (its hidden negotiation numbers and its current interest, patience and other meters) SHALL be stored with the session as structured data and MUST read back exactly as written. Nothing in this capability exposes it to players.

#### Scenario: Round trip
- **WHEN** an investor state with a budget of €700,000 and a patience of 3 is saved and read back
- **THEN** the same budget and patience are returned

### Requirement: Chat messages
The system SHALL store each chat message with its session, role, text and creation time, and MUST return a session's messages in the order they were created, including messages created in the same millisecond.

#### Scenario: Ordered transcript
- **WHEN** three messages are added to a session within the same millisecond
- **THEN** listing the session's messages returns them in insertion order

### Requirement: Offers
The system SHALL store each offer with its session, side (`player` or `investor`), investment, equity, implied valuation and turn. It MUST list a session's offers in turn order and return the latest offer from a given side.

#### Scenario: Latest investor offer
- **WHEN** the investor offered 30% on turn 0 and 24% on turn 2, and the player offered 15% on turn 1
- **THEN** the latest investor offer is the 24% offer from turn 2

### Requirement: Decision log
The system SHALL store one decision log entry per decision call made for a session, with: the session, the turn, the stage (`A`, `B` or `debrief`), the provider, the model, the questions asked, the answers (or the error code when the call failed), the latency in milliseconds and the creation time. Entries MUST be listable per session, ordered by turn and then creation order.

#### Scenario: Insights for a session
- **WHEN** a session has decision log entries for turns 1 and 2
- **THEN** listing them returns turn 1's entries before turn 2's, each with its questions, answers and latency

### Requirement: Data integrity
Messages, offers and decision log entries SHALL each belong to an existing game session. Deleting a game session MUST delete its messages, offers and decision log entries.

#### Scenario: Orphan rejected
- **WHEN** a message is stored for a session id that does not exist
- **THEN** the write fails

#### Scenario: Cascade delete
- **WHEN** a game session with messages, offers and decision log entries is deleted
- **THEN** none of its messages, offers or decision log entries remain

### Requirement: Schema migration
The storage schema for game data SHALL be created automatically when the API starts, through a migration that only adds tables. Existing player records MUST be preserved.

#### Scenario: Upgrade an existing database
- **WHEN** the API starts against a database created before this change, containing players
- **THEN** the game tables are created and every existing player is still present
