## Why

The brain judges and the policy decides, but the investor still has no voice: nothing writes the opening line, phrases the policy's action in the persona's tone, or offers the player context-aware reply options. In the tutor's loop the regular LLM is the **voice**: it phrases what code decided and never changes a number. This is the last piece the game engine (§12) needs before a full turn can run.

## What Changes

- **Opening offer** (code): the investor anchors high. The opening offer is the founder's ask amount (capped by the budget) for the persona's maximum equity, e.g. €500k for 30%.
- **`PromptBuilder`**: builds the thinking-model prompts from the persona's name, personality and tone, the startup, recent chat, and **what was decided**: the action and the exact numbers to say, preformatted. Prompts never contain the investor's hidden numbers (budget, equity limits, interest, patience), and player text is marked as untrusted data.
- **`OpeningGenerator`**: the investor's greeting and first offer.
- **`InvestorDialogueGenerator`**: the investor's reply to each policy action (`counter`, `accept`, `reject`, `clarify`, `dismiss`, `walk_away`) in the persona's voice.
- **`NumberConsistencyChecker`**: finds every amount and percentage in generated text (reusing the brain's candidate extractor) and checks them against the numbers in play. The decided offer must be stated, and no other number may be invented. On a mismatch the line is regenerated once with feedback, then replaced by a code-written template line.
- **`PlayerOptionsGenerator`**: the thinking model suggests 1–3 context-aware replies as zod-validated JSON (counters, messages, leverage). Code then:
  - validates every number and recomputes the implied valuation
  - rewrites counter labels so they match their offer
  - drops duplicates and options with invented numbers
  - always adds **Accept** (the investor's current offer) and **Walk away**, for 3–5 options in total

  If generation fails, code builds the options itself.
- **`InvestorVoice`**: generates the dialogue and the options **in parallel** for a turn, and falls back to template lines and code-built options when the thinking provider is down. A reply is always produced, and every fallback is flagged and logged.

Out of scope: the game engine and endpoints (§12), v2 writers (due-diligence questions, event narration, debrief coaching), and term-trading options.

## Capabilities

### New Capabilities
- `investor-voice`: prompt construction, the opening line, investor dialogue per action, generated player options, number consistency checks, fallbacks, and parallel generation.

### Modified Capabilities
- `negotiation-policy`: adds the opening offer rule (code computes the investor's first offer).

## Impact

- **New code**: `apps/api/src/voice/**` (prompt builder, generators, checker, fallback lines, `InvestorVoice`), `apps/api/src/game/OpeningOfferCalculator.ts`, `Container` wiring, and tests with `FakeThinkingProvider`.
- **Existing code**: reuses `ThinkingProvider.generateText` / `generateJson` (with their retry), `OfferCandidateExtractor`, `MoneyFormatter`, `ValuationCalculator` and `PlayerOptionSchema` unchanged.
- **Config / database / API surface**: no changes.
- **Dependencies**: none.
