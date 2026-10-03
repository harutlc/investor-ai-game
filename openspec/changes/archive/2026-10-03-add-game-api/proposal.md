## Why

The game engine can start games, play turns and serve their public view, but only from code: the web UI (§15) and Postman have no way to reach it. §14 puts HTTP in front of the engine, behind the API's existing security (anonymous player cookie, CSRF, rate limits, error envelope), and proves over HTTP that the investor's hidden numbers never leave the server.

## What Changes

- **`GameController`** under `/api/games`:
  - `POST /api/games`: start a game from `{ personaId, pitch }`. Returns 201 with the game.
  - `GET /api/games`: list the current player's games, newest first, as summaries.
  - `GET /api/games/:id`: the game's public view.
  - `POST /api/games/:id/turns`: play a move (`optionId`, `offer` or `message`). Returns the updated game and the messages the turn added.
  - `GET /api/games/:id/insights`: the game's decision log for the brain-insights panel.
- **Validation**: bodies are checked with the shared request schemas (`CreateGameRequestSchema`, `PlayTurnRequestSchema`), and `:id` must be a UUID. Bad input gets the existing 400 `VALIDATION_ERROR` envelope with the field paths.
- **Game list contract** (shared): `GameSummaryDto` (id, persona's public profile, startup name, status, turn, turn limit, investor's current offer, timestamps) and `GameListDto`, both strict, with no hidden numbers.
- **`GameSessionService.listSessions`**: the player's games as summaries.
- **Responses**: game responses are `Cache-Control: no-store` (private, changing state). Engine errors keep their mapping (404 `NOT_FOUND`, 409 `GAME_FINISHED` / `TURN_IN_PROGRESS`, 422 `INVALID_MOVE`, 503/502 provider errors).
- **Tests**: Supertest for every endpoint, including CSRF, ownership, validation and a full game over HTTP that asserts **no hidden investor number or key appears in any response**.
- **Postman**: the "Game" folder gains Start game, List games, Get game, Play a turn (offer / message / option) and Insights, chaining `gameId` and `optionId` through collection variables.

Out of scope: the web UI (§15), v2 endpoints (scenarios, debrief) and a separate rate limit for turns (the existing mutation limit applies).

## Capabilities

### New Capabilities
- `game-api`: the `/api/games` endpoints, their validation, status codes, caching and error mapping, and the guarantee that no response carries hidden investor numbers.

### Modified Capabilities
- `game-domain`: adds the game list contract (`GameSummaryDto`, `GameListDto`).
- `game-engine`: adds listing a player's games.

## Impact

- **New code**: `apps/api/src/http/controllers/GameController.ts`, `GameSessionService.listSessions` and a summary mapping, shared `GameSummaryDto` / `GameListDto`, `Container` registration, API tests, Postman requests, README.
- **API surface**: five new routes under `/api/games`, all behind the player session, CSRF (for POSTs) and rate limits.
- **Database / config / dependencies**: none.
