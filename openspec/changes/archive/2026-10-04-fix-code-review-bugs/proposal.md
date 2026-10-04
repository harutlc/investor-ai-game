## Why

`CODE_REVIEW.md` (commit `666abf4`) lists 19 findings. Each one was checked against the code and the current specs. Two are real bugs, where the code does something the specs don't intend:

- **L3:** When the player accepts, the investor is told it is accepting the *founder's* offer.
- **L7:** A deeply nested playground schema crashes the request with a 500 instead of a 400.

This change fixes only those two. The other findings are deployment hardening, design choices the specs already describe, or code-quality cleanups. They are triaged in `CODE_REVIEW_TRIAGE.md` and are out of scope here.

## What Changes

- **Player-accept closing line (L3).** When the player accepts the investor's current offer, the voice writes a dedicated *closing* line. It confirms the deal at the investor's own offer instead of using the policy `accept` instruction ("Accept the founder's offer and close the deal"). The closing line must state the offer's investment and equity, and it has its own template fallback. The policy `accept` action (the investor accepts the player's offer) is unchanged.
- **Bounded playground schema measurement (L7).** `POST /api/dev/thinking/json` stops walking the client schema once it passes the depth limit. An over-deep schema is rejected with 400 `VALIDATION_ERROR` instead of overflowing the stack and returning 500. The spec now states the existing size limits (10 levels deep, 50 declared properties).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `investor-voice`: "Dialogue for every action" gains a closing line for a player accept. "Number consistency" requires that line to state the accepted offer.
- `llm-playground`: "Thinking JSON endpoint" states the schema size limits and that exceeding them, however deep, is a 400 `VALIDATION_ERROR`.

## Impact

- `apps/api/src/voice/`: `VoiceContext.ts` (new line subject), `PromptBuilder.ts`, `FallbackLines.ts`, `InvestorVoice.ts` (a closing method).
- `apps/api/src/game/GameEngine.ts`: the player-accept branch calls the closing line.
- `apps/api/src/http/controllers/PlaygroundController.ts`: `measure()` stops early.
- Tests in `apps/api/test/voice/`, `apps/api/test/game/GameEngine.test.ts` and `apps/api/test/api/playground.test.ts`.
- No API, DTO or database changes.
