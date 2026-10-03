## 1. Persistence and errors

- [x] 1.1 Add `player_options` (JSON, not null, default `[]`) to `gameSessions` in `db/schema.ts` and generate migration `0002` with `pnpm db:generate` (review: one `ALTER TABLE … ADD`). Extend `GameSession` / `GameSessionUpdate` with `playerOptions`, validated with `z.array(PlayerOptionSchema)` on write and read, and add an optional `expectedTurn` to `update` that returns whether a row changed (design §6 risk). Verify repository tests: options round-trip; a `counter` option without an offer fails the write; updating options to a new set and then to `[]` reads back exactly; `update` with a stale `expectedTurn` changes nothing and returns `false`; a `Database` test migrates a database seeded with a session at `0001` and reads it back with no options
- [x] 1.2 Add `Database.transaction(fn)` (design §2). Verify a `Database` test: writes inside a transaction that throws are rolled back, and a successful one commits
- [x] 1.3 Add `GAME_FINISHED`, `INVALID_MOVE` and `TURN_IN_PROGRESS` to the shared `ErrorCode`, and implement `GameNotFoundError` (404 `NOT_FOUND`), `GameAlreadyFinishedError` (409), `InvalidMoveError` (422) and `TurnInProgressError` (409). Verify unit tests for each status and code, and `pnpm --filter @investor/shared test` still passes

## 2. Read side

- [x] 2.1 Implement `game/GameSessionMapper.ts` (design §7: DTO from the session, persona profile, transcript, last player offer, meters, limit; insights from decision logs; both parsed with their shared schemas). Verify tests: a mapped session passes `GameSessionDtoSchema` and its JSON has no `budget`, `patience`, `interest` or `concessionStep` key and no budget value; options are empty for a finished game; dates are ISO; insights pass `DecisionInsightsDtoSchema` and carry no `sessionId`
- [x] 2.2 Implement `game/GameSessionService.ts` (`getSession`, `getInsights`, ownership through `findForPlayer`). Verify tests: the owner gets the view; another player and an unknown id both get `GameNotFoundError`

## 3. Engine

- [x] 3.1 Implement `game/TurnLock.ts`. Verify tests: a second `acquire` of the same id throws `TurnInProgressError`; different ids don't block each other; `release` frees the id
- [x] 3.2 Implement `game/MoveResolver.ts` (design §3). Verify tests with the fake decision provider: an unknown option id → `InvalidMoveError`; accept / decline / counter / message options map to the right move with the label as chat text and no Stage A call; a structured offer gets the "€500k for 15%." text; free text "I could do 20%" against €550k / 24% → offer €550k / 20%; an uncertain extracted equity is ignored; a confident `accept` intent → player accept, an uncertain one does not; injection 0.93 → dismissal outcome
- [x] 3.3 Implement `GameEngine.startGame` (design §8). Verify tests: greedy-shark with a €500k ask → turn 0, `negotiating`, current offer €500k / 40%, a system message then the investor's line, one investor offer at turn 0, 3–5 stored options for turn 1; an unknown persona → `ValidationError` on `personaId` and no session row
- [x] 3.4 Implement `GameEngine.playTurn` (design §2, §4): lock, load, finished check, resolve, accept / decline / dismiss / evaluate paths, voice, one transaction with the expected-turn check, result with `newMessages`. Verify tests: a counter turn advances to turn 1 with the policy's offer, both messages, both offers and new options; a player accept → `deal` at the investor's offer with a closing line and no options; a decline → `rejected_by_player` with the system message; an injection → no Stage B log, offer unchanged, patience −1; the last allowed turn → `out_of_turns` with no options; a move on a finished game → `GameAlreadyFinishedError`; a Stage B `ProviderUnavailableError` → the error, and the session, messages, offers and options are unchanged while the failed call is logged; a concurrent second move → `TurnInProgressError` and the first completes

## 4. Integration and wiring

- [x] 4.1 Wire `turnLock`, `moveResolver`, `gameSessionMapper`, `gameSessionService` and `gameEngine` into `Container`. Verify `test/api/container.test.ts` builds them
- [x] 4.2 Add `test/game/GameEngine.integration.test.ts` with the container, fake providers and scripted answers: (a) a full game ending in a deal (opening → player counter → investor counter → player accepts the investor's offer), checking the transcript order, offers per turn, final status and that `getInsights` lists the Stage B entries per turn; (b) a game ending in a walk-away (repeated rejects until patience runs out); (c) ownership: another player's `getSession` / `playTurn` → `NOT_FOUND`. Verify the file passes and every returned view validates against the shared schemas

## 5. Docs and verification

- [x] 5.1 Update `README.md` with a "Game engine" section (the turn pipeline, what is saved atomically, the new error codes, one turn at a time). Verify it lists `GAME_FINISHED`, `INVALID_MOVE` and `TURN_IN_PROGRESS`
- [x] 5.2 Run the full gate: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` and `pnpm test`. Verify all pass, and that the existing suites are unchanged in count except for the new tests
