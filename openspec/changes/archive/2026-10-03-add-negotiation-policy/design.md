## Context

- The brain (`apps/api/src/brain/`) returns `PlayerMoveInterpretation` (Stage A: intent, injection, extracted offer) and `InvestorJudgment` (Stage B: `deal.accept` score 0–4, `deal.reaction`, `deal.goodDeal`, `deal.concessionSize`, optional `conduct.insult` …), each answer as `Judged<T> { value, confidence, uncertain }`. The brain never acts on them.
- The hidden investor state is `InvestorState { budget, minEquity, maxEquity, concessionStep, interest, patience }` (`apps/api/src/game/InvestorState.ts`), stored per session. Offers are `{ investment, equity }` (`OfferInput`); `Offer` adds `impliedValuation`, `from` and `turn`, computed by the engine.
- `InvestorMetersSchema` (shared) is the public hint contract: `interestLevel: low|medium|high`, `patienceHint` (1–120 chars), optional `trustHint`.
- `AppConfigSchema` is strict zod with `superRefine` for cross-field rules; `ConfigLoader` errors name the failing key path.

Motivation: `proposal.md`. Required behavior: `specs/negotiation-policy/spec.md` and `specs/game-domain/spec.md`.

## Goals / Non-Goals

**Goals:**
- Deterministic, pure functions of (judgment, state, offers, settings): no I/O, no clock, no randomness, so every rule is unit-testable.
- One place for every number the game master uses: `game.policy` in config, the persona's hidden numbers in `InvestorState`.

**Non-Goals:**
- Calling the brain, saving state or offers, or producing text. The engine (§12) orchestrates; the voice (§11) phrases the action.
- v2: trust/respect/fomo, `ask_question`/`request_proof`, phases, term trades, caught bluffs, events.
- Deciding whether a free-text move *is* a player accept/decline: the engine maps Stage A's intent (or the clicked option's kind) to the move kind it passes to `TurnLimiter`.

## Decisions

### 1. Layout and types
```
apps/api/src/game/
  InvestorAction.ts        InvestorAction union + PolicyOutcome
  PolicySettings.ts        type alias for config.game.policy
  NegotiationPolicy.ts     guard() and decide()
  InvestorStateUpdater.ts  interest / patience rules
  MeterHintMapper.ts       InvestorState → InvestorMeters
  TurnLimiter.ts           status after a move
```
```ts
type InvestorAction =
  | { kind: 'accept' | 'counter' | 'reject' | 'clarify' | 'dismiss'; offer: OfferInput }
  | { kind: 'walk_away'; reason: 'out_of_patience' | 'decided' };

interface PolicyOutcome { action: InvestorAction; investorState: InvestorState }
```
Every non-walk-away action carries the offer the investor now stands behind (for `accept`, the player's offer). The engine can then always persist "the current investor offer" from the action without branching, and the voice always knows which numbers to say. *Alternative:* `offer?` only on counter/accept. Rejected: the engine and the number-consistency checker (§11.8) would each re-derive the unchanged offer.

### 2. Two entry points, one outcome type
- `guard({ interpretation, investorState, currentOffer }): PolicyOutcome | null` runs after Stage A. At or above `injectionThreshold` it returns `dismiss` (or `walk_away` if the injection cost empties patience) and the engine skips Stage B. Otherwise it returns `null`.
- `decide({ judgment, investorState, currentOffer, playerOffer }): PolicyOutcome` runs after Stage B.

`decide` works in three steps, so the "out of patience" rule sees the updated state:
1. Choose the base action from the judgment (spec order: uncertain → no offer → accept checks → counter / reject / walk-away confidence).
2. `InvestorStateUpdater.afterMove(state, { action, judgment })`.
3. If the action is not `accept` and patience is 0, replace it with `walk_away` (`out_of_patience`).

`currentOffer` is required: the engine always opens with an investor offer (§11.4), so there is no turn without one.

### 3. Counter math
```ts
const move = settings.concessionSteps[size] * state.concessionStep;
const gap = player.equity - current.equity;          // negative when the player wants less
const equity = clamp(round2(current.equity + Math.sign(gap) * Math.min(Math.abs(gap), move)),
                     state.minEquity, state.maxEquity);
const investment = Math.min(player.investment, state.budget);
```
"Toward the player, never past" works in both directions, so an unusually generous player is not overshot either. The clamp comes last, so the persona's limits always win. Equity is rounded with the same 2-decimal rule as `EquityPercentSchema`. The investment follows the player's ask because amount and equity are negotiated together; capping at the budget is the only hidden-number rule MVP needs (the mock's "€550k for 24%" step is this rule).

*Alternative:* keep the investor's own investment and negotiate equity only. Rejected: a player asking for more money would never be heard.

### 4. State updates
`afterMove` returns a new object:
- `interest = clamp01(interest + (goodDeal − 0.5) × interestWeight)`; rounded to 4 decimals to keep stored JSON tidy.
- `patience −= (action === 'reject' ? reject : 0) + (insult ≥ insultThreshold ? insult : 0)`, floored at 0.

`guard` uses a separate `afterInjection(state)` (patience only; there is no `good_deal` to move interest). The base `walk_away` (`decided`) still updates interest and patience, which keeps the stored state honest for the debrief.

### 5. Meter hints are presentation, not tuning
The interest bands (0.35 / 0.65) and the five patience phrases are constants in `MeterHintMapper`, not config: they decide wording, not behavior, and the UI mock already uses this vocabulary. `trustHint` is left out until trust exists (v2); the schema already makes it optional. A test validates every output with `InvestorMetersSchema` and checks it contains no digits.

### 6. `game.policy` config
```json
"policy": {
  "acceptMinLevel": 3, "goodDealMin": 0.5, "walkAwayMinConfidence": 0.7,
  "injectionThreshold": 0.6, "insultThreshold": 0.6,
  "concessionSteps": { "none": 0, "small": 1, "medium": 2, "large": 3 },
  "patienceCost": { "reject": 1, "insult": 2, "injection": 1 },
  "interestWeight": 0.2
}
```
A strict zod object inside `GameConfigSchema`. A `refine` on `concessionSteps` (none ≤ small ≤ medium ≤ large) reports the path `game.policy.concessionSteps`. `acceptMinLevel` is 0–4, the score scale the brain returns. `PolicySettings` is `AppConfig['game']['policy']`; the policy and updater take it by constructor, so tests can pass their own.

### 7. `TurnLimiter`
`new TurnLimiter(maxTurns).statusAfter({ playerMove: 'accept' | 'decline' | 'other', action?: InvestorAction, turn })` follows the spec's order: player accept/decline, then investor accept/walk-away, then `turn ≥ maxTurns`, else `negotiating`. When the player accepts or declines, the investor is not evaluated, so `action` is optional. It also exposes `turnsLeft(turn)`. The name follows TASKS §10.8, although it also handles the end conditions.

### 8. Wiring
`Container` builds `investorStateUpdater`, `negotiationPolicy`, `meterHintMapper` and `turnLimiter` from `config.game`. Nothing calls them until the engine change.

## Risks / Trade-offs

- **[Risk]** Moves without an offer (questions, small talk) become `reject` and cost patience, so an inquisitive player tires the investor. → This is intended "stalling" pressure from §1.5. The cost is configurable, and v2 adds `ask_question` handling.
- **[Risk]** Low thresholds make injection or insult false positives expensive. → Both thresholds sit above a coin flip (0.6), both are configurable, and the confidence gate already marks borderline answers.
- **[Trade-off]** `clarify` ignores `concession_size` and everything else whenever `reaction` is uncertain. → This is §1.10's rule. Other uncertain answers are still visible to the engine and the insights panel.
- **[Trade-off]** Counters can repeat the same offer (`concession_size = none`). → It is the investor holding firm without the patience cost of a `reject`; the voice phrases it as "my offer stands".
