## 1. Player-accept closing line (L3)

- [x] 1.1 In `apps/api/src/voice/VoiceContext.ts`, add `'closing'` to `LineSubject['kind']` and to `MUST_STATE_OFFER`. Verify `pnpm typecheck` flags the missing `PromptBuilder` and `FallbackLines` entries.
- [x] 1.2 Add a `closing` instruction to `LINE_INSTRUCTIONS` in `apps/api/src/voice/PromptBuilder.ts`: the founder accepted the investor's offer, so confirm the deal on that offer. Verify with a `PromptBuilder.test.ts` case: a closing subject's system prompt contains the closing instruction and `NUMBERS TO STATE`, and does not contain "Accept the founder's offer".
- [x] 1.3 Add a `closing` template to `apps/api/src/voice/FallbackLines.ts` that states the offer. Verify with `FallbackLines.test.ts`: add `closing` to `subjects`, and check that the template passes the number check and states €550k and 24%.
- [x] 1.4 Add `apps/api/src/voice/ClosingGenerator.ts`, mirroring `OpeningGenerator`, and an `InvestorVoice.close(context, offer)` method that writes the closing line, returns `options: null` and logs fallbacks under kind `closing`. Wire it in `apps/api/src/container/Container.ts` and in the `InvestorVoice.test.ts` setup. Verify with an `InvestorVoice.test.ts` case: `close` produces a line with no options and makes no options-generation call.
- [x] 1.5 Change the player-accept branch of `GameEngine.decide` (`apps/api/src/game/GameEngine.ts`) to call `voice.close(context, currentOffer)`. Verify that the "closes the deal when the player accepts the investor's offer" test in `GameEngine.test.ts` still passes, and add an assertion that the line came from the closing subject (e.g. the thinking stub got the closing instruction, or the fallback text is the closing template).

## 2. Bounded playground schema measurement (L7)

- [x] 2.1 In `apps/api/src/http/controllers/PlaygroundController.ts`, make `measure()` return as soon as `depth > MAX_SCHEMA_DEPTH`, without recursing further. Verify with a `apps/api/test/api/playground.test.ts` case: posting a schema nested ~20,000 levels deep (built as a string, under the 100 kb body limit) returns 400 `VALIDATION_ERROR` on `body.schema` and makes no provider call.
- [x] 2.2 Verify the existing playground tests still pass: a valid schema, and a schema just over the depth or property limit returning 400.

## 3. Verification

- [x] 3.1 Run `pnpm -r test`, `pnpm typecheck` and `pnpm lint`. All pass.
- [x] 3.2 Run `openspec validate fix-code-review-bugs --strict`. It passes.
