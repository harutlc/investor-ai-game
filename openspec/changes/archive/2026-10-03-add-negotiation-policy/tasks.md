## 1. Policy settings

- [x] 1.1 Add the strict `game.policy` object to `GameConfigSchema` per design §6 (`acceptMinLevel` 0–4, the four 0–1 thresholds, `concessionSteps` with the non-decreasing refine on `game.policy.concessionSteps`, integer `patienceCost` ≥ 0, `interestWeight` 0–1), the committed values in `config/app.config.json`, the same values in `test/support/testConfig.ts`, and `apps/api/src/game/PolicySettings.ts`. Verify `ConfigLoader` tests: the committed config loads with the design's values; `concessionSteps` `{0, 2, 1, 3}` fails naming `game.policy.concessionSteps`; `injectionThreshold: 1.5` fails naming `game.policy.injectionThreshold`; the existing suite still passes

## 2. Actions and state

- [x] 2.1 Add `game/InvestorAction.ts` (`InvestorAction` union and `PolicyOutcome`, design §1) and implement `game/InvestorStateUpdater.ts` (`afterMove`, `afterInjection`, design §4). Verify tests: interest 0.5 with `good_deal` 0.9 → 0.58; interest stays within 0–1 at the extremes; patience 4 with `reject` and insult 0.91 → 1; insult 0.5 costs nothing; patience never goes below 0; the input state object is unchanged and budget, equity limits and concession step are copied as-is
- [x] 2.2 Implement `game/MeterHintMapper.ts` (bands and phrases from the spec, no `trustHint`). Verify tests: interest 0.72 / patience 2 → `high` / `Tapping the table`; the band edges 0.35 and 0.65; every patience from 0 to 7 maps to the right phrase; every output passes `InvestorMetersSchema` and contains no digits

## 3. Negotiation policy

- [x] 3.1 Implement `NegotiationPolicy.decide` per design §2–§3 (base action in spec order, counter math with clamping and 2-decimal rounding, state update, out-of-patience override). Verify tests built from `Judged` fixtures: accept inside the limits (€550k for 22% with a €600k budget and a 22% minimum); accept downgraded to counter below the minimum equity; uncertain reaction → `clarify` with the offer and patience unchanged; no player offer → `reject`; walk-away confidence 0.6 → `reject`, 0.8 → `walk_away` (`decided`); patience 1 + `reject` → `walk_away` (`out_of_patience`); every carried offer passes `OfferInputSchema`
- [x] 3.2 Cover the counter math with table tests: 30% vs 15% with `medium` and step 4 → 22%; 30% vs 28% with `large` → 28%; minimum 25% clamp → 25%; a generous player (30% vs 35%, `small`, step 4) → 34%; `none` → 30%; player asks €800k with a €700k budget → €700k; 1.5-point steps round to 2 decimals
- [x] 3.3 Implement `NegotiationPolicy.guard` (injection at or above the threshold → `dismiss` with the current offer and the injection cost; walk-away if that empties patience; below the threshold → `null`). Verify tests: injection 0.93 → `dismiss` and patience −1; injection 0.2 → `null`; patience 1 + injection → `walk_away` (`out_of_patience`)

## 4. End conditions and wiring

- [x] 4.1 Implement `game/TurnLimiter.ts` (`statusAfter`, `turnsLeft`, design §7). Verify tests: player accept → `deal`; player decline → `rejected_by_player`; investor `accept` → `deal`; `walk_away` → `walked_away`; counter on turn 15 of 15 → `out_of_turns`; investor accept on turn 15 → `deal`; counter on turn 3 → `negotiating`; `turnsLeft` never negative
- [x] 4.2 Wire `investorStateUpdater`, `negotiationPolicy`, `meterHintMapper` and `turnLimiter` into `Container` from `config.game`. Verify `test/api/container.test.ts` builds them and the turn limiter uses `game.maxTurns`

## 5. Docs and verification

- [x] 5.1 Update `README.md`: the `game.policy` keys in the config table and a short "Negotiation policy" section (actions, counter math, injection guard, end conditions). Verify the README lists every policy key
- [x] 5.2 Run the full gate: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` and `pnpm test`. Verify all pass, and that the existing suites are unchanged in count except for the new tests
