## Why

The investor brain now returns typed, gated judgments (`PlayerMoveInterpretation`, `InvestorJudgment`), but nothing turns them into what the investor actually does. In the tutor's loop, **code is the game master**: it decides the action, computes the counter-offer from the persona's hidden numbers, updates the investor's mood and ends the game. The game engine (§12) and dialogue generation (§11) both need that decision as a stable contract, so the policy comes next.

## What Changes

- **`NegotiationPolicy`**: turns a judgment, the investor's hidden state and the current offers into an `InvestorAction`:
  - `accept`: only when the model says so (`reaction = accept`), the `accept` score and `good_deal` probability clear their thresholds, **and** the player's offer is inside the investor's limits; otherwise downgraded to `counter`.
  - `counter`: a new offer computed in code. Equity moves `concession_size × concessionStep` toward the player's equity, never past it, and is kept between the persona's minimum and maximum equity. The investment follows the player's ask, capped by the budget.
  - `reject`: the current offer is repeated and patience drops.
  - `walk_away`: patience runs out, or the model says `walk_away` with high confidence (a less confident one is downgraded to `reject`).
  - `clarify`: when the model is uncertain about `reaction`, the investor asks a clarifying question instead of acting (§1.10).
  - **Injection guard**: a Stage A injection probability at or above a threshold makes the investor brush it off in character (`dismiss`), costs patience, and keeps the offer unchanged.
- **`InvestorStateUpdater`**: updates `interest` (driven by `good_deal`) and `patience` (rejections, insults, injection attempts) after every move.
- **`MeterHintMapper`**: turns hidden `interest` and `patience` into the public `InvestorMeters` hints (`low | medium | high`, "Tapping the table", …). Numbers never reach the player.
- **`TurnLimiter`**: decides the game status after a move: `deal` (either side accepts), `walked_away`, `rejected_by_player`, `out_of_turns` (the turn limit is reached), or still `negotiating`.
- **Policy settings**: a new `game.policy` config section with every threshold and weight (accept level, good-deal minimum, walk-away confidence, injection and insult thresholds, concession steps, patience costs, interest weight), validated at startup. No magic numbers in code.

Out of scope: wiring this into turns (the game engine, §12), dialogue (§11), and the v2 parts of §10 (trust/respect/fomo, phases, term trades, claim verification, market events).

## Capabilities

### New Capabilities
- `negotiation-policy`: the investor's actions and how they are chosen, the counter-offer math, the injection guard, investor-state updates, public meter hints, and the game's end conditions.

### Modified Capabilities
- `game-domain`: the `Game settings` requirement gains the `game.policy` section.

## Impact

- **New code**: `apps/api/src/game/` (`InvestorAction.ts`, `NegotiationPolicy.ts`, `InvestorStateUpdater.ts`, `MeterHintMapper.ts`, `TurnLimiter.ts`), `Container` wiring, and unit tests for each.
- **Config**: new `game.policy` section in `AppConfigSchema`, `config/app.config.json` and `test/support/testConfig.ts`; README config table. No new environment variables.
- **Database / API surface**: no changes. The policy is pure code; nothing calls it until the game engine change.
- **Dependencies**: none.
