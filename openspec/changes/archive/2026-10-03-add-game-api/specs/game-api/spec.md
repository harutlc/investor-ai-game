## Purpose

The HTTP interface to the game: start a game, list and read a player's games, play turns and read the decision log, under `/api/games`, behind the API's player session, CSRF protection, rate limits and error envelope. No response ever carries the investor's hidden numbers.

## ADDED Requirements

### Requirement: Start a game
`POST /api/games` SHALL start a game for the current player from a JSON body `{ personaId, pitch }` and respond with 201 and the game's public view. An unknown persona or an invalid pitch MUST be rejected with 400 `VALIDATION_ERROR` naming the field, and nothing is stored.

#### Scenario: New game
- **WHEN** a player posts `{ "personaId": "greedy-shark", "pitch": { … GreenCharge, valuation 2000000, askAmount 500000 } }` with a valid CSRF token
- **THEN** the response is 201 with a game that is `negotiating` on turn 0, an investor offer, two messages and 3–5 options

#### Scenario: Invalid pitch
- **WHEN** the pitch has `askAmount: 0`
- **THEN** the response is 400 `VALIDATION_ERROR` with a detail for `body.pitch.askAmount`

#### Scenario: Missing CSRF token
- **WHEN** CSRF protection is on and the request has no token
- **THEN** the response is 403 `CSRF_INVALID` and no game is created

### Requirement: List a player's games
`GET /api/games` SHALL return `{ games: [...] }` with the current player's games as summaries, newest first, and never another player's games.

#### Scenario: Two games
- **WHEN** a player has started two games and another player one
- **THEN** the list holds the player's two games, the newer first

### Requirement: Read a game
`GET /api/games/:id` SHALL return the game's public view. `:id` MUST be a UUID, otherwise 400 `VALIDATION_ERROR`. An unknown id, or a game owned by another player, MUST give 404 `NOT_FOUND`.

#### Scenario: Another player's game
- **WHEN** player B requests player A's game
- **THEN** the response is 404 `NOT_FOUND`, identical to an unknown id

### Requirement: Play a turn
`POST /api/games/:id/turns` SHALL accept exactly one of `optionId`, `offer` (`{ investment, equity }`) or `message` and respond with 200 and `{ session, newMessages }`. The engine's errors MUST map as follows:

| Situation | Response |
| --- | --- |
| Two inputs, or none | 400 `VALIDATION_ERROR` |
| Unknown option | 422 `INVALID_MOVE` |
| Game already finished | 409 `GAME_FINISHED` |
| A turn of that game still running | 409 `TURN_IN_PROGRESS` |
| Decision provider down | 503 `PROVIDER_UNAVAILABLE` |
| Decision provider returned something unusable | 502 `PROVIDER_BAD_RESPONSE` |

#### Scenario: Counter-offer
- **WHEN** a player posts `{ "offer": { "investment": 500000, "equity": 15 } }` on a new game
- **THEN** the response is 200, the game is on turn 1, and `newMessages` holds the player's and the investor's messages

#### Scenario: Two inputs
- **WHEN** a player posts both `optionId` and `message`
- **THEN** the response is 400 `VALIDATION_ERROR` and the game is unchanged

### Requirement: Decision insights
`GET /api/games/:id/insights` SHALL return the game's decision log as `{ entries: [...] }` for its owner, with the same 400/404 rules as reading a game.

#### Scenario: After a turn
- **WHEN** a player reads the insights of a game after one evaluated turn
- **THEN** the entries include that turn's Stage B decisions

### Requirement: Private, uncached game responses
Every `/api/games` response SHALL carry `Cache-Control: no-store`. No response, success or error, MAY contain the investor's hidden numbers (budget, equity limits, interest, patience, concession step) or the persona's brain and voice descriptions.

#### Scenario: Full game over HTTP
- **WHEN** a player starts a game with the greedy shark and plays it to the end over HTTP
- **THEN** no response contains the keys `budget`, `minEquity`, `maxEquity`, `patience`, `concessionStep`, `personality` or `toneInstructions`, nor the shark's budget value
