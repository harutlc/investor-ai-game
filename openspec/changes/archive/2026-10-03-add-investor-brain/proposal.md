## Why

The decision providers, the confidence gate, decision logging, personas and game sessions all exist, but nothing asks the investor's brain a question yet. The tutor's core loop (state → decision model → policy → LLM text) starts with a well-built **state** and a set of narrow, typed **questions**, and every later step (the negotiation policy, dialogue generation, the game engine) consumes the brain's typed answers. This change builds that brain so the policy (§10) can be written against a stable `InvestorJudgment` contract and tested with the fake decision provider.

## What Changes

- **Negotiation state** (`NegotiationStateBuilder`): builds the decision state from the session, persona, pitch and offers, following the tutor's example: `phase`, `turn`, `turns_left`, `startup`, `player_offer` (with code-computed checks against the investor's limits), `player_message`, `investor` (personality, goals, hidden numbers, meters, current offer) and a short plain-English `history` of earlier offers.
- **Offer candidate extraction** (`OfferCandidateExtractor`): code finds every amount-like (`500k`, `€0.5M`, `500,000`) and percent-like (`15%`, `15 percent`) number in a free-text message and normalizes it. The model never writes a number; it only picks one ("select instead of generate").
- **Stage A, understand the player's move**:
  - `PlayerIntentQuestions`: `intent` (choice: `counter_offer | accept | decline | ask_question | answer_question | leverage_claim | small_talk | other`) and `injection` (noul).
  - `OfferExtractionQuestions`: `investment` and `equity` choices built from the candidates, each with a `none` option; questions with no candidates are not asked.
- **Stage B, evaluate and decide**:
  - `DealDecisionQuestions`: the tutor's `accept` (5-level score), `reaction` (choice: `accept | counter | reject | walk_away`) and `good_deal` (noul), plus `concession_size` (choice: `none | small | medium | large`).
  - `PlayerConductQuestions`: `politeness` (score), `insult` (noul) and `confidence` (score); asked only when the move has text.
- **`InvestorBrain`**: `understand()` runs Stage A, `evaluate()` runs Stage B. All question sets of a stage run in parallel, every call goes through `DecisionLogger` (stage `A` or `B`), and every answer is passed through `ConfidenceGate` so the result says which judgments are uncertain. It returns typed results: `PlayerMoveInterpretation` and `InvestorJudgment`.
- **`QuestionSetRegistry`**: question sets are classes that declare their stage and, optionally, the feature flag that enables them; the registry returns the sets enabled by `game.features`. Adding a judgment means adding one class.
- **`MoneyFormatter`** (`packages/shared`): compact euro formatting (`€500k`, `€1.2M`) used by the history lines and question labels, and later by the voice and the UI.

Out of scope, for later changes: the negotiation policy and state updates (§10), dialogue and options (§11), the game engine and `/api/games` endpoints (§12, §14), and the v2 question sets (claims, credibility, due diligence, terms, tactics, ethics, technical, debrief). No HTTP endpoint changes in this change.

## Capabilities

### New Capabilities
- `investor-brain`: the negotiation state sent to the decision model, offer candidate extraction, the Stage A and Stage B question sets, the question-set registry and feature filtering, and the `InvestorBrain` that runs the stages and returns gated, typed judgments.

### Modified Capabilities
- `game-domain`: adds compact money formatting (`MoneyFormatter`) to the shared game contracts.

## Impact

- **New code**: `apps/api/src/brain/**` (state builder, candidate extractor, question sets, registry, brain and result types), `packages/shared/src/game/MoneyFormatter.ts`, `Container` wiring (`investorBrain`), and tests for each using `FakeDecisionProvider`.
- **Existing code**: none changed beyond the container and the shared index; `DecisionLogger`, `ConfidenceGate` and the decision provider contract are used as they are.
- **Config / database / API surface**: no changes. The brain reads the existing `game.features`, `game.maxTurns` and `llm.decision.minConfidence` settings, and logs to the existing `decision_logs` table.
- **Dependencies**: none.
