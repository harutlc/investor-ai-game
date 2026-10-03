## Why

The brain, the policy and the voice are all built and tested in isolation, but no code yet runs a game: nothing creates a session with an opening offer, resolves a player's move, runs the two decision stages, applies the policy, phrases the result, and saves it all. The game engine (§12) is that orchestration, and the `/api/games` endpoints (§14) and the web UI (§15) need it as their single entry point.

## What Changes

- **`GameEngine.startGame`**: validates the persona and builds the hidden investor state from its numbers. Code computes the opening offer, and the voice writes the greeting and the player's first options. The engine then saves the session, its messages, the opening offer and the options, and returns the public `GameSessionDto`.
- **`GameEngine.playTurn`** resolves the move and then runs the turn:
  - A **generated option** is used directly: accept, decline, counter with its offer, or message/leverage with its label.
  - A **structured offer** is used directly.
  - **Free text** goes through Stage A. The injection guard can end the turn with an in-character dismissal. A confident `accept`/`decline` intent ends the game, and an extracted offer is completed from the investor's offer when only one side was given.
  - Player accept or decline ends the game; otherwise Stage B, the policy, the turn limit and the voice run.
  - Everything the turn produced is saved in **one transaction**: messages, offers, the investor state, status, turn and options. Decision logs are written as the brain runs. The result is a `TurnResultDto`.
- **Persisted options**: game sessions store the current player options, so a later `optionId` can be resolved. This needs one additive migration.
- **`GameSessionService`**: read side for the API, with `getSession` (the public DTO: persona profile, pitch, status, offers, meter hints, messages, options) and `getInsights` (the decision log per turn). Hidden investor numbers are never part of either.
- **Errors**: `GameNotFoundError` (404, also for another player's game), `GameAlreadyFinishedError` (409 `GAME_FINISHED`), `InvalidMoveError` (422 `INVALID_MOVE`, e.g. an unknown option id), `TurnInProgressError` (409 `TURN_IN_PROGRESS`, when a second move arrives for a game whose turn is still running), and an unknown persona as a 400 validation error. Provider failures keep their existing 503/502 mapping.
- **Integration tests** with the fake providers: a full game ending in a deal, one ending in a walk-away, plus out-of-turns, injection, player decline and option resolution.

Out of scope: the HTTP endpoints (`/api/games`, next change), listing a player's games, v2 steps (phases, events, claims, debrief) and the web UI.

## Capabilities

### New Capabilities
- `game-engine`: starting a game, playing a turn (move resolution, both decision stages, policy, voice, end conditions), atomic persistence, the read side (session DTO and insights), one turn at a time per game, and the game error codes.

### Modified Capabilities
- `game-persistence`: game sessions also store the player's current options, and session updates can change them.

## Impact

- **New code**: `apps/api/src/game/GameEngine.ts`, `MoveResolver.ts`, `GameSessionMapper.ts`, `GameSessionService.ts`, `TurnLock.ts`, four error classes, `Database.transaction()`, `Container` wiring, and unit and integration tests.
- **Shared**: `ErrorCode` gains `GAME_FINISHED`, `INVALID_MOVE` and `TURN_IN_PROGRESS`.
- **Database**: migration `0002` adds `player_options` (JSON, default `[]`) to `game_sessions`. Additive; existing rows read as no options.
- **API surface**: none yet; endpoints come in the next change.
- **Dependencies**: none.
