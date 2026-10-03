## MODIFIED Requirements

### Requirement: Game sessions
The system SHALL store each game session persistently with at least: a server-generated UUID, the owning player's id, the persona id, an optional scenario id, the startup pitch, the status, the phase, the current turn number, the investor's current offer (if any), the investor's state, the player's current reply options (empty when there are none), and created and updated timestamps. A game session MUST belong to an existing player. Sessions stored before options existed MUST read back with no options.

#### Scenario: Create and read back
- **WHEN** a game session is created for an existing player and read back by id
- **THEN** every stored field is returned unchanged

#### Scenario: Unknown player
- **WHEN** a game session is created for a player id that does not exist
- **THEN** the write fails and no session is stored

#### Scenario: Invalid option rejected
- **WHEN** a game session is stored with a `counter` option that has no offer
- **THEN** the write fails and nothing is stored

### Requirement: Session updates
The system SHALL update a session's status, phase, turn, current investor offer, investor state and player options together, and MUST refresh its updated timestamp on every update.

#### Scenario: Turn advances
- **WHEN** a session's turn, investor offer and investor state are updated
- **THEN** reading it back returns the new values and a later updated timestamp

#### Scenario: Options replaced
- **WHEN** a session's options are updated to a new set, and later to an empty list
- **THEN** reading it back returns exactly the latest set each time
