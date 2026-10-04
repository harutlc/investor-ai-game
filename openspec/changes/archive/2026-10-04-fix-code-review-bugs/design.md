## Context

Both bugs are small and local, and each has more than one reasonable fix. See proposal.md for why they're in scope.

- **L3:** `GameEngine.decide` handles a player accept by calling `voice.respond(context, { kind: 'accept', offer: currentOffer })`. That reuses the policy `accept` action, which `InvestorAction.ts` documents as "the player's offer, accepted". `PromptBuilder`'s `LINE_INSTRUCTIONS.accept` reads "Accept the founder's offer and close the deal", so on a player accept the model is told the wrong story. The numbers are still right, because the subject's offer is the investor's current offer and `NumberConsistencyChecker` enforces it.
- **L7:** `PlaygroundController.measure()` recurses through every node of the client schema and only then compares the depth to `MAX_SCHEMA_DEPTH`. A ~100 kb body of nested arrays or objects gives tens of thousands of levels. A local repro hit `RangeError: Maximum call stack size exceeded` at 19,000 levels; the error handler turns it into a 500. `express.json` and the zod `record(string, unknown)` check don't recurse into the value, so `measure()` is the first code to walk it.

## Goals / Non-Goals

**Goals:**
- The player-accept closing line gets an accurate instruction and its own fallback, and the policy `accept` behavior is unchanged.
- A schema that is too deep is rejected with 400, however deep it goes.

**Non-Goals:**
- Any other `CODE_REVIEW.md` finding (see `CODE_REVIEW_TRIAGE.md`).
- Changing the depth or property limits themselves.

## Decisions

**1. A separate `closing` line subject, not a new `InvestorAction` kind.**
`LineSubject['kind']` becomes `InvestorActionKind | 'opening' | 'closing'`. A player accept isn't a policy decision: the spec says neither Stage B nor the policy runs. So it belongs next to `opening` as a voice-only subject, not in `InvestorAction`, which `InvestorStateUpdater` and `TurnLimiter` also consume. `closing` is added to:
- `MUST_STATE_OFFER`, so the offer must appear;
- `LINE_INSTRUCTIONS`, e.g. "The founder has accepted your offer. Confirm the deal on your offer and close the negotiation.";
- `FallbackLines`, e.g. `Deal. ${offer} it is.`

`Record<LineSubject['kind'], string>` and the exhaustive `switch` in `FallbackLines` make the compiler report anything that's missing.
- *Alternative:* add context to the existing `accept` instruction ("whoever made the offer…"). Rejected: it keeps one instruction covering two different situations, which is the ambiguity that caused the bug.

**2. `InvestorVoice.close(context, offer)` instead of reusing `respond`.**
`respond` takes an `InvestorAction`, and a player accept isn't one. Like `open`, a dedicated method writes one line through `LineWriter` with `{ kind: 'closing', offer }` and returns `{ line, options: null }`. It logs fallbacks under kind `closing`. `GameEngine`'s player-accept branch calls it. `InvestorDialogueGenerator` stays bound to policy actions, and `InvestorVoice` uses `LineWriter` through a small `ClosingGenerator`, matching `OpeningGenerator`, so the constructor wiring in `Container` follows the existing pattern.

**3. Pass a depth cap through `measure()`.**
`measure(node, depth)` returns as soon as `depth > MAX_SCHEMA_DEPTH`, reporting that depth, so `toZod` raises its existing "must be nested at most 10 levels deep" `ValidationError`. Recursion then never goes past 11 levels. The property count also stops early in that case, which is fine because the depth error is reported first.
- *Alternative:* an iterative walk with an explicit stack. Rejected: it's more code for no gain once the depth is capped.
- *Alternative:* catch `RangeError` and map it to 400. Rejected: it still burns the stack and relies on engine-specific overflow behavior.

## Risks / Trade-offs

- [The new closing instruction yields lines the number checker rejects more often] → It falls back to the template line, like every other subject. The existing fallback logging shows whether this happens.
- [Tests that assert `voice.respond` was called with `kind: 'accept'` on a player accept] → Update them to expect `close`. That's the intended behavior change.
