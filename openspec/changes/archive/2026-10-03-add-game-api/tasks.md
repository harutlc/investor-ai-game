## 1. Contracts and read side

- [x] 1.1 Add strict `GameSummaryDtoSchema` and `GameListDtoSchema` (design §3) to `packages/shared/src/game/GameDtos.ts`. Verify shared tests: a valid summary parses; a summary with `budget` is rejected; `currentInvestorOffer: null` is accepted
- [x] 1.2 Add `GameSessionMapper.toSummary` and `GameSessionService.listSessions`. Verify tests: two games of one player come back newest first, another player's game is excluded, and every summary passes `GameSummaryDtoSchema`

## 2. Controller

- [x] 2.1 Implement `http/controllers/GameController.ts` with the five routes from design §1 (validation with the shared schemas and a UUID `:id`, `req.player.id`, status codes, `Cache-Control: no-store`) and register it in `Container`. Verify with `pnpm --filter @investor/api typecheck` and a container test that `/api/games` is mounted
- [x] 2.2 Write `test/api/games.test.ts` (Supertest with a CSRF agent, scripted decision provider and `UnavailableThinkingProvider`) for the spec scenarios:
  - 201 start
  - 400 for an invalid pitch and for an unknown persona
  - 403 without a CSRF token
  - the list, newest first and only the player's own games
  - 200 get and 404 for another player's game
  - 400 for a malformed id
  - 200 counter turn with `newMessages`
  - 400 for two inputs
  - 422 for an unknown option
  - 409 after the game ended
  - 503 when the decision provider is down
  - insights with the turn's Stage B entries
  - `no-store` on every response

  Verify the file passes
- [x] 2.3 Add the full-game leak test (design §4): start → offer → free text → get → insights → accept → list, checking every response body against the hidden-key and budget deny list. Verify it passes, and fails if a hidden field is added to a response by hand (checked once locally, then reverted)

## 3. Postman and docs

- [x] 3.1 Add the "Game" requests to `postman/investor-api.postman_collection.json` (design §5) with a `gameId` / `optionId` chain, CSRF headers and tests. Verify the JSON parses, the folder lists the new requests in run order, and (when a server is available) `newman` runs the folder against `pnpm dev` with fake providers
- [x] 3.2 Update `README.md`: an endpoint table for `/api/games` in the API section, and the Postman folder row. Verify the README names all five routes

## 4. Verification

- [x] 4.1 Run the full gate: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` and `pnpm test`. Verify all pass, and that the existing suites are unchanged in count except for the new tests
