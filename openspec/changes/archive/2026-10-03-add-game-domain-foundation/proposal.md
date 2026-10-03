## Why

The API can now call the thinking and decision models, but the game itself has no shape yet: there are no offers, no game sessions, no investors and no place to record what the brain decided. Every next step (the investor brain, the negotiation policy, dialogue generation, the game engine and the web UI) needs these shared types, game settings, tables and personas first. This change builds that foundation so the game loop can be written against stable contracts and tested with the fake providers.

## What Changes

- **Shared game contracts** (`packages/shared`): zod schemas and inferred types for `Money`, `EquityPercent`, `Offer`, `StartupPitch`, `ChatMessage`, `PlayerOption`, `GameStatus`, `GamePhase`, `InvestorMeters` (public hints only), `InvestorPersonaDto` (public fields only), `GameSessionDto`, `TurnResultDto`, `DecisionInsightsDto`, `CreateGameRequest` and `PlayTurnRequest`. No endpoint uses the game DTOs yet; they are the contract for the game engine change.
- **`ValuationCalculator`** (`packages/shared`): pure valuation math shared by the API and the UI (`impliedPostMoney`, `impliedPreMoney`, `equityFor`, `amountFor`), with unit tests.
- **Game settings**: a new `game` section in `config/app.config.json` (`currency`, `maxTurns`, `defaultValuation`, `features` flags) and a `minConfidence` setting under `llm.decision`, all validated at startup. The v2 feature flags are added now, off, so later changes only flip them.
- **Persistence**: new tables `game_sessions` (owned by a player), `messages`, `offers` and `decision_logs`, a Drizzle migration, and one repository class per table. Hidden investor state is stored server-side only.
- **Confidence gate**: a `ConfidenceGate` that marks decision answers below `llm.decision.minConfidence` as uncertain, so the future policy can ask a clarifying question instead of acting.
- **Decision logging**: a `DecisionLogger` that runs a decision request for a given game session, turn and stage, and records the questions, answers (or the error), provider, model and latency in `decision_logs`.
- **Investor personas**: an `InvestorPersona` class (public fields, brain description, voice instructions, hidden numbers) and a `PersonaCatalog` with six hard-coded personas: greedy shark, generous angel, angry/rude, content/well-fed, skeptical analyst and impact investor. Persona definitions are validated when the catalog is built.
- **`GET /api/personas`**: lists the personas with public fields only. Hidden numbers, brain descriptions and voice instructions never appear in the response.

Out of scope, for later changes: the investor brain and question sets, the negotiation policy, dialogue and option generation, the game engine and `/api/games` endpoints, scenarios, v2 persona fields (`termWeights`, `bluffSensitivity`, `ethicsStrictness`), the v2 tables (`player_claims`, `game_events`, `score_reports`) and the web UI.

## Capabilities

### New Capabilities
- `game-domain`: the shared game contracts, valuation math and validated game settings (`game` config section and feature flags).
- `game-persistence`: storage of game sessions, chat messages, offers and decision logs, with player ownership of sessions and hidden investor state kept server-side.
- `investor-personas`: the hard-coded investor persona catalog, persona validation and the public `GET /api/personas` endpoint.

### Modified Capabilities
- `decision-llm`: adds a configurable confidence threshold with a gate that flags uncertain answers, and recording of every game decision call (including failures) in the decision log.

## Impact

- **New code**: `packages/shared/src/game/**` (schemas, `ValuationCalculator`), `apps/api/src/db/schema.ts` and a new migration, `apps/api/src/repositories/*` (four repositories), `apps/api/src/llm/decision/ConfidenceGate.ts` and `DecisionLogger.ts`, `apps/api/src/personas/**`, `PersonaController`, `Container` wiring, and tests for each.
- **Config**: new `game` section and `llm.decision.minConfidence` in `config/app.config.json`, the config schema and `test/support/testConfig.ts`. No new environment variables or secrets.
- **Database**: one additive migration (four new tables with foreign keys). Existing `players` data is untouched.
- **API surface**: new `GET /api/personas` behind the existing session, CSRF and rate-limit middleware. The Postman collection gains one request.
- **Dependencies**: none.
