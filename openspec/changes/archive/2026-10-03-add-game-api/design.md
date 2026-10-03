## Context

- Controllers implement `Controller { basePath, routes() }`, and `Container` passes them to `ApiServer`, which mounts them under `/api` after the global middleware: request id, security headers, CORS, the global rate limit, cookie parser, JSON-only guard, body limit, `PlayerSessionMiddleware` (sets `req.player`), optional CSRF on unsafe methods, and the mutation rate limit (60 per 15 minutes by default). Errors go through `ErrorHandlerMiddleware`, so any thrown `AppError` becomes the envelope with its status and code.
- `ValidationMiddleware.validate({ body, params })` makes object schemas strict, reports issues as `body.pitch.askAmount`-style paths, and exposes parsed values through `ValidationMiddleware.validated(res, schemas)`. Express 5 forwards rejected async handlers to the error handler.
- The engine side exists: `GameEngine.startGame(playerId, request)`, `playTurn(playerId, gameId, request)`, and `GameSessionService.getSession` / `getInsights`, with ownership enforced and errors already mapped to `AppError`s.
- API tests use `createTestApp()` plus a Supertest agent that fetches `/api/csrf-token` and sends `X-CSRF-Token` (see `playground.test.ts`). The Postman collection has a "Game" folder and sets `csrfToken`, `playerId` and `personaId` as collection variables.

Motivation: `proposal.md`. Required behavior: the three delta specs.

## Goals / Non-Goals

**Goals:**
- A thin controller: validate, call the engine or service with `req.player.id`, and send the DTO. Every rule stays in the engine.
- A test that proves over HTTP that hidden numbers do not leak, with no reliance on unit tests of the mapper.

**Non-Goals:**
- Pagination of the game list, deleting games, v2 routes, and per-route rate limits.

## Decisions

### 1. Routes and handlers
```
GET    /api/games                 → service.listSessions(playerId)          200 GameListDto
POST   /api/games                 → engine.startGame(playerId, body)         201 GameSessionDto
GET    /api/games/:id             → service.getSession(playerId, id)        200 GameSessionDto
POST   /api/games/:id/turns       → engine.playTurn(playerId, id, body)     200 TurnResultDto
GET    /api/games/:id/insights    → service.getInsights(playerId, id)       200 DecisionInsightsDto
```
`params: z.object({ id: z.uuid() })`. `CreateGameRequestSchema` and `PlayTurnRequestSchema` come from `packages/shared` unchanged (both already strict; the turn schema's "exactly one input" refinement gives the 400). Handlers are arrow-function properties, like the existing controllers, and every response sets `Cache-Control: no-store`.

A malformed id is a 400 rather than a 404: it can never name a game, so the privacy argument for a uniform 404 doesn't apply, and the 400 tells a client author exactly what is wrong.

### 2. No `Location` header on 201
The body already carries the id. The UI navigates with it, and a `Location` would need the public base URL behind proxies. Keeping it out is the simpler contract.

### 3. Summaries for the list
`GameSummaryDto` in `packages/shared/src/game/GameDtos.ts`:
```ts
{ id, persona: InvestorPersonaDto, startupName, status, turn, maxTurns, currentInvestorOffer: Offer | null,
  createdAt, updatedAt }   // .strict()
```
`GameSessionMapper.toSummary(session, persona)` names each field and parses it with the schema. `GameSessionService.listSessions(playerId)` maps `sessions.listForPlayer(playerId)`. That method already orders newest first and scopes to the player, and the list loads no messages or offers.

### 4. The leak test
`test/api/games.test.ts` plays a whole game through Supertest with the greedy shark:
1. Start the game.
2. Counter with a structured offer, then with free text.
3. Read the game and its insights.
4. Accept the investor's offer.
5. List the games.

Every response body (`res.text`) is checked against a deny list:
- the keys `"budget"`, `"minEquity"`, `"maxEquity"`, `"patience"`, `"concessionStep"`, `"personality"`, `"toneInstructions"` and `"interest"` (with quotes, so `interestLevel` stays allowed)
- the shark's budget written as `600000`, `€600k` and `€600,000`

The decision provider is scripted. The thinking provider is `UnavailableThinkingProvider`, so lines are deterministic.

### 5. Postman
New requests in the "Game" folder: Start game, List games, Get game, Play turn: offer, Play turn: message, Play turn: option, and Insights.
- *Start game* stores `gameId`, and each turn stores `optionId` from the first `counter` or `message` option.
- POSTs send `X-CSRF-Token: {{csrfToken}}` and carry the same pre-request warning as the playground.
- Tests check the status, the shape and the hidden-key deny list.

The collection-level test script already checks headers and the error envelope.

## Risks / Trade-offs

- **[Risk]** Turns take seconds with real models, and the mutation limit of 60 per 15 minutes allows about three full games per window. → This is fine for MVP play and demos, and the limit is configurable (`security.rateLimit.mutationMax`). A per-route turn limit can come later if needed.
- **[Trade-off]** A slow turn holds the HTTP request open. → It is acceptable for MVP; streaming (SSE) is a v3 stretch goal. The engine's turn lock turns a double submit into a quick 409 instead of a second slow request.
