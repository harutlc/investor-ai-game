## Context

Everything the engine orchestrates already exists and is wired in `Container`:
- **Brain**: `NegotiationStateBuilder.build(...)` gives the state. `InvestorBrain.understand(...)` (Stage A) and `evaluate(...)` (Stage B) take `{ sessionId, turn, state, message }`, log every call through `DecisionLogger`, and throw `ProviderUnavailableError` / `ProviderBadResponseError`.
- **Policy**: `NegotiationPolicy.guard(...)` and `decide(...)` return `{ action, investorState }`. `TurnLimiter.statusAfter({ playerMove, action?, turn })` gives the status, `MeterHintMapper.toMeters(...)` the public hints, and `OpeningOfferCalculator.offer(...)` the opening offer.
- **Voice**: `InvestorVoice.open(context, offer)` and `respond(context, action, { nextTurn })` never throw on provider problems; options are `null` once the action ends the game.
- **Persistence**: `GameSessionRepository` (`create`, `findForPlayer`, `update`, …), `MessageRepository`, `OfferRepository` (`add`, `listForSession`, `latest`) and `DecisionLogRepository`. `Database` wraps a single better-sqlite3 connection (`database.sqlite`).
- **Contracts**: `GameSessionDto`, `TurnResultDto`, `DecisionInsightsDto`, `PlayTurnRequest` (exactly one of `optionId` / `offer` / `message`) and `CreateGameRequest` in `packages/shared`.

Motivation: `proposal.md`. Required behavior: `specs/game-engine/spec.md` and `specs/game-persistence/spec.md`.

## Goals / Non-Goals

**Goals:**
- One obvious path per turn, each step a call into an already-tested component; the engine adds only move resolution, sequencing and persistence.
- A failed turn leaves the game exactly as it was (apart from decision logs).
- Fully testable with the fake providers and `:memory:` SQLite.

**Non-Goals:**
- HTTP routing, request validation and the player cookie: the next change (`/api/games`).
- Listing a player's games (no summary DTO exists yet), v2 steps, a cross-process lock.

## Decisions

### 1. Layout
```
apps/api/src/game/
  GameEngine.ts          startGame(), playTurn()
  MoveResolver.ts        option / offer / free text → ResolvedMove (+ Stage A)
  GameSessionMapper.ts   GameSession + messages + offers → GameSessionDto; logs → insights
  GameSessionService.ts  getSession(), getInsights()
  TurnLock.ts            per-game in-process lock
apps/api/src/errors/
  GameNotFoundError.ts  GameAlreadyFinishedError.ts  InvalidMoveError.ts  TurnInProgressError.ts
apps/api/src/db/Database.ts    + transaction(fn)
```
`GameNotFoundError` reuses `NOT_FOUND`, so an unknown game looks exactly like any other missing resource. New shared codes: `GAME_FINISHED` (409), `INVALID_MOVE` (422) and `TURN_IN_PROGRESS` (409).

### 2. Turn pipeline
```
lock(sessionId) → load (findForPlayer) → must be negotiating → turn = session.turn + 1
→ MoveResolver.resolve(...)                     // Stage A only for free text; may run policy.guard
→ player accept / decline?  → closing line (voice, accept) or system message
→ else if dismissed         → voice.respond(dismiss | walk_away)
→ else                      → state → brain.evaluate → policy.decide → turnLimiter → voice.respond
→ transaction { messages, offers, session.update }   // all sync, no awaits inside
→ mapper.toDto(...) + newMessages                 → unlock (finally)
```
All model calls (Stage A, Stage B, voice) finish before the transaction starts, and the transaction contains only synchronous repository calls. `Database.transaction(fn)` is `this.sqlite.transaction(fn)()`: better-sqlite3 runs it as `BEGIN … COMMIT` and rolls back on a throw. Every repository shares the same connection, so the existing repository instances take part without being rebuilt. Decision logs are written by the brain as its calls happen, outside the transaction. This is intended: they record what the model did, even for turns that fail.

### 3. Move resolution
```ts
type ResolvedMove = {
  playerMove: 'accept' | 'decline' | 'other';   // for TurnLimiter
  chatText: string;                             // the player's chat message
  offer: OfferInput | null;
  brainMessage: string | null;                  // free text only → conduct questions
  intent: PlayerIntent | null;                  // Stage A intent, for the state
  dismissal: PolicyOutcome | null;              // injection guard fired
};
```
- **Option**: looked up in `session.playerOptions` by id, or `InvalidMoveError`. `chatText` is the option's label.
- **Offer**: `chatText` is `"€500k for 15%."` (`MoneyFormatter.compact`).
- **Free text**: state without an offer → `brain.understand`, then `policy.guard`. If that returns an outcome, the move is dismissed. Otherwise:
  - A non-uncertain intent of `accept` / `decline` becomes the player move.
  - The offer comes from the non-uncertain extracted values, with a missing side filled from `session.currentInvestorOffer`.

Filling the missing side follows how people talk ("I could do 20%" keeps the investor's amount). Uncertain extractions are ignored rather than guessed: the brain's confidence gate already says they are unreliable.

### 4. What a turn writes
| Outcome | Messages | Offers | Session |
| --- | --- | --- | --- |
| player accept | player, investor (voice `accept` with the current offer) | — | status `deal`, phase `finished`, options `[]` |
| player decline | player, system "You walked away from the negotiation." | — | status `rejected_by_player`, phase `finished`, options `[]` |
| dismissed | player, investor (voice `dismiss` / `walk_away`) | — | state from the guard, status from `TurnLimiter` |
| evaluated | player, investor | player's offer (if any), investor's offer on `counter` / `accept` | state, status, current offer = the action's offer (when it carries one), options = voice options or `[]` |

On an investor `accept`, the agreed terms are stored as the investor's current offer (with `from: 'investor'`), so "current offer while status is `deal`" always means the deal. Message timestamps come from the clock in order (player, then investor), and each message gets a UUID.

The voice context uses the session's transcript plus the new player message, `previousInvestorOffer` = the offer before the turn, and the resolved player offer.

### 5. Options are stored on the session
A new column, `game_sessions.player_options` (JSON, `NOT NULL DEFAULT '[]'`), is validated with `z.array(PlayerOptionSchema)` on write and read, like the other JSON columns. `GameSession` and `GameSessionUpdate` gain `playerOptions`. Migration `0002` is generated with drizzle-kit; existing rows get `[]`.

*Alternative:* a `player_options` table. Rejected because options are replaced every turn and never queried on their own; a column keeps them atomic with the session update.

### 6. One turn at a time: `TurnLock`
`TurnLock` is a `Set<string>` of session ids being processed. `acquire(id)` throws `TurnInProgressError` if the id is already held, and `release(id)` runs in a `finally`. The engine acquires the lock before loading the session, so a double-click cannot read the same turn twice. The lock is in-process, which is enough for the single-process SQLite deployment. The risk section covers more instances.

### 7. Read side
`GameSessionMapper.toDto(session, { persona, messages, lastPlayerOffer, maxTurns, meters })` builds the DTO by naming each public field and then parses it with `GameSessionDtoSchema`, so an accidental hidden field fails loudly in tests. `GameSessionService` (`getSession`, `getInsights`) loads through `findForPlayer` (ownership) and throws `GameNotFoundError`. Insights map `DecisionLogEntry` → `DecisionLogEntryDto` (ISO dates, no `sessionId` or `id`). The engine reuses the mapper for its results.

### 8. Start game
`startGame({ playerId, personaId, pitch })`:
1. Look up the persona with `personaCatalog.findById`, or throw a `ValidationError` on `personaId`.
2. Seed the state from the persona: `{ ...numbers without initialInterest, interest: initialInterest }`.
3. Compute the opening offer.
4. Call `voice.open(...)` with a history holding only the system message.
5. In one transaction: create the session, add the system and investor messages, add the opening offer, and store the options.

The voice runs before any write, so a crash during it leaves nothing behind.

## Risks / Trade-offs

- **[Risk]** The in-process lock does not protect against two API processes on one database file. → The project runs one process with SQLite. The transaction also re-checks the turn: `update` uses `WHERE id = ? AND turn = ?`, and if that changes no row the transaction rolls back with `TurnInProgressError`.
- **[Risk]** Long model calls hold the lock for seconds, so a quick second click gets 409. → This is intended; the UI disables input while a turn is processing (§15.8).
- **[Trade-off]** A failed turn keeps its decision log entries. → They show *why* the turn failed in the insights panel; they never change the game.
- **[Trade-off]** A player decline gets no investor line, which saves a model call when the player has already left. A player accept gets one (a closing line), because the deal moment deserves it.
