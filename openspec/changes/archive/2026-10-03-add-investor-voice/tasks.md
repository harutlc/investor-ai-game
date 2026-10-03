## 1. Opening offer

- [x] 1.1 Implement `game/OpeningOfferCalculator.ts` (design §8). Verify tests: €500k ask with a €700k budget and a 30% maximum → €500k for 30%; €900k ask with a €600k budget and a 40% maximum → €600k for 40%; the result passes `OfferInputSchema`

## 2. Prompts and numbers

- [x] 2.1 Add `voice/VoiceContext.ts` and implement `voice/PromptBuilder.ts` (design §3: system sections, last 8 messages mapped to roles, player text wrapped in `<player_message>` tags, the per-action instruction table, opening and options prompts). Verify tests: a counter prompt names `counter`, `€550k`, `€550,000`, `24%` and the persona's tone; a 12-message history keeps the last 8; player text appears only inside `<player_message>` blocks; for each of the six catalog personas, no prompt contains its budget (compact or full), patience or concession step, nor its min or max equity unless that equity is the decided offer's
- [x] 2.2 Implement `voice/NumbersInPlay.ts` and `voice/NumberConsistencyChecker.ts` (design §4, reusing `OfferCandidateExtractor`). Verify tests: "I'll do €550k for 24%" passes for a counter of €550k / 24%; "€550k for 21%" fails, naming 21%; "€3.3M" passes against a €500k-for-15% player offer; a line missing the required equity fails; a number from the player's message is allowed; amounts within €1,000 pass for small values

## 3. Lines

- [x] 3.1 Implement `voice/FallbackLines.ts` (one code-written line per action plus the opening, numbers via `MoneyFormatter.compact`). Verify tests: every fallback line passes `NumberConsistencyChecker` for its own action, and `walk_away` / `clarify` lines state no numbers
- [x] 3.2 Implement the shared generate → check → retry → fallback helper, `voice/OpeningGenerator.ts` and `voice/InvestorDialogueGenerator.ts` (design §5). Verify tests with `FakeThinkingProvider`: a good first line is used as-is (`fallback: false`); a bad first line and a good second line → the second, and the retry request contains the problems; two bad lines → the template line (`fallback: true`); a `ProviderUnavailableError` → the template line; an empty or over-4000-character reply counts as a failure; the opening states the opening offer

## 4. Player options

- [x] 4.1 Implement `voice/PlayerOptionsGenerator.ts` (design §6). Verify tests with scripted JSON: a counter at 22% plus a message → 4 options in order with Accept "Accept €550k for 24%" and "Walk away"; a counter labelled 18% with equity 20 is relabelled "Counter: €500k for 20%"; the counter carries `impliedValuation` from `ValuationCalculator` and `from: 'player'`; a counter equal to the investor's offer and a duplicate counter are dropped; a message with an invented number is dropped; invalid JSON twice → the code-built counter, Accept and Walk away with `fallback: true`; the midpoint counter for 24% vs 20% is 22% and with no player offer is 18%; ids are unique; every option passes `PlayerOptionSchema`; the total is always 3–5

## 5. Voice facade and wiring

- [x] 5.1 Implement `voice/InvestorVoice.ts` (`open`, `respond`, design §7) with warn-level logging of fallbacks (action kind and error code only). Verify tests: `respond` starts the dialogue and options requests before either resolves (a provider that waits for both requests); `accept` and `walk_away` return `options: null`; a down provider returns the template line and code-built options, both flagged; the captured logs contain neither the prompt nor the player's text
- [x] 5.2 Wire `openingOfferCalculator` and `investorVoice` (with its generators, the checker and the brain's `OfferCandidateExtractor`) into `Container`. Verify `test/api/container.test.ts` builds them, and `open()` with the fake thinking provider returns a line and 3–5 valid options

## 6. Docs and verification

- [x] 6.1 Update `README.md` (layout lists `src/voice`; an "Investor voice" section covering what the prompts contain, the number check with retry and fallback, and how options are built). Verify the section names the fallback behavior and the always-present Accept / Walk away options
- [x] 6.2 Run the full gate: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` and `pnpm test`. Verify all pass, and that the existing suites are unchanged in count except for the new tests
