## Context

- `ThinkingProvider` offers `generateText({ system, messages })` and `generateJson({ system, messages, schema })`. JSON is parsed and zod-validated, with one retry that shows the model its errors; a second failure throws `ProviderBadResponseError`. An outage throws `ProviderUnavailableError`. `FakeThinkingProvider` serves scripted replies FIFO, and fails JSON requests when the script is empty.
- The brain's `OfferCandidateExtractor` already finds and normalizes amounts and percentages in free text (currency signs, `k`/`M`, `%`/`percent`, bare-number rules). `MoneyFormatter` gives `€500k` / `€500,000`, and `ValuationCalculator` gives post- and pre-money valuations.
- The policy's `InvestorAction` carries the offer the investor stands behind (`accept`, `counter`, `reject`, `clarify`, `dismiss`), or a walk-away reason.
- `PlayerOptionSchema` (shared): `{ id, kind: counter|accept|decline|message|answer|leverage, label (1–120), offer? }`, where `counter` requires an `Offer` (`investment`, `equity`, `impliedValuation`, `from`, `turn`).

Motivation: `proposal.md`. Required behavior: `specs/investor-voice/spec.md` and `specs/negotiation-policy/spec.md`.

## Goals / Non-Goals

**Goals:**
- The voice phrases; it never decides. Every number the player sees passes a code check.
- A turn always completes: the voice degrades to code-written lines and options instead of failing.
- Testable offline with `FakeThinkingProvider`.

**Non-Goals:**
- Saving messages or options, or choosing when to speak. That is the engine's job (§12).
- Streaming (v3), v2 writers (due diligence, events, debrief), and deal-term options.

## Decisions

### 1. Layout
```
apps/api/src/game/OpeningOfferCalculator.ts   ask capped by budget, at maxEquity
apps/api/src/voice/
  VoiceContext.ts            the inputs a line needs (no InvestorState)
  PromptBuilder.ts           system prompts + history messages
  NumbersInPlay.ts           the allowed / required numbers for a line
  NumberConsistencyChecker.ts
  FallbackLines.ts           code-written line per action + opening
  OpeningGenerator.ts
  InvestorDialogueGenerator.ts
  PlayerOptionsGenerator.ts
  InvestorVoice.ts           open() and respond(): dialogue + options in parallel
```

### 2. The voice never sees `InvestorState`
```ts
interface VoiceContext {
  persona: Pick<InvestorPersona, 'name' | 'personality' | 'toneInstructions'>;
  pitch: StartupPitch;
  history: readonly { role: ChatRole; text: string }[];   // oldest first; the voice keeps the last 8
  playerMessage: string | null;
  playerOffer: OfferInput | null;
  previousInvestorOffer: OfferInput | null;
}
```
The hidden-numbers rule is enforced by the types: the context has no field that could carry the budget or the limits. `persona` is a `Pick`, so `numbers` cannot be passed in by accident. The only hidden-derived values the voice sees are decided offers, which the player is meant to see anyway. A test builds every prompt for each of the six personas and asserts that none of their hidden values appear unless they are a number in play.

### 3. Prompt shape
- The **system** prompt has fixed sections: who you are (name, personality, tone), the startup, *the decision* (action plus the numbers to state, compact and full), the rules, and the untrusted-input notice. Player text never goes into the system prompt.
- The **messages** are the last 8 chat messages: investor lines become `assistant` messages and player lines become `user` messages, each player message wrapped as `<player_message>…</player_message>`. Event and system messages become a one-line `user` note (`[event] …`). The final `user` message is the instruction for this line ("Write your reply now…").
- Wording per action is a small table: counter "Make this counter-offer", reject "Hold your current offer and say no to theirs", clarify "Ask what exactly they are proposing", and so on.

The template strings live in `PromptBuilder` as constants, so all prompt text sits in one file.

### 4. Number consistency
`NumbersInPlay.for(context, decidedOffer)` returns `{ amounts: number[], equities: number[], required: OfferInput | null }`. The allowed numbers are:
- the offers in play, each one's post-money and pre-money valuation, and the differences between the offers ("the extra €50k", "4 points apart")
- the pitch's valuation and ask amount
- the candidates `OfferCandidateExtractor` finds in the pitch description and the player's message

`NumberConsistencyChecker.check(text, numbers)` runs the same extractor over the generated text. Each amount must match an allowed amount within `max(2%, €1,000)`, and each equity must match an allowed equity within 0.005. When an offer is required, both of its numbers must appear. The result is `{ ok, problems: string[] }`, and the problems are fed back on the retry ("You wrote 21%; the only offer to state is 24%.").

Reusing the extractor means the checker reads numbers exactly the way Stage A does. Its false positives (e.g. "in 3 years" reads as 3%) lead to a regeneration or a fallback, never a wrong number reaching the player.

### 5. Generate → check → retry once → template
`InvestorDialogueGenerator.write(context, action)` and `OpeningGenerator.write(context, offer)` share one helper:
1. Call `generateText`.
2. Check the line.
3. If it fails, call `generateText` once more, appending the problems as a `user` message.
4. If that fails too, use `FallbackLines`.

A `ProviderUnavailableError` or `ProviderBadResponseError` at any step goes straight to the fallback. The result is `{ text, fallback: boolean }`, with text trimmed and capped at 4000 characters (a longer line counts as a failure). The fallback lines name the numbers via `MoneyFormatter.compact`. For example, a counter falls back to "I can do €550k for 24%. That's my offer."

### 6. Options: the model suggests, code decides
`generateJson` with the schema `{ options: [{ kind: 'counter'|'message'|'leverage', label: string(1..120), investment?: int, equity?: number }] (1..3) }`. Code then processes the suggestions in order:
1. A counter without valid `investment`/`equity` (per `MoneySchema`/`EquityPercentSchema`) is dropped.
2. For a counter, code builds an `Offer` with `from: 'player'`, `turn: nextTurn` and `impliedValuation` from `ValuationCalculator`. If the label's extracted numbers don't equal the offer's, the label is replaced with `Counter: ${compact} for ${equity}%`.
3. Duplicates are dropped: a counter with the same terms as the investor's current offer, or as an earlier counter, and a label already used.
4. A message or leverage option whose label has numbers outside the numbers in play is dropped.
5. Code appends `{ kind: 'accept', label: 'Accept €X for Y%' }` and `{ kind: 'decline', label: 'Walk away' }`.
6. If no suggestion survived, code inserts the fallback counter before Accept (the spec's midpoint rule, rounded to 0.5, skipped if it equals the investor's equity).

Ids are `opt-${turn}-${index}`. Every option is checked with `PlayerOptionSchema` before it is returned, so a bug cannot produce an invalid option. A failed generation (`ProviderBadResponseError` or `ProviderUnavailableError`) gives the code-built set and `fallback: true`.

The accept option carries no `offer`: the investor's current offer is already in the session, and the engine resolves "accept" against it. This avoids a second copy of the offer that could go stale.

### 7. `InvestorVoice`
```ts
open(context, offer): Promise<{ line: VoiceLine; options: VoiceOptions }>
respond(context, action, { nextTurn, currentOffer }): Promise<{ line: VoiceLine; options: VoiceOptions | null }>
```
`respond` runs the dialogue and the options with `Promise.all`. Options are `null` when the action ends the game (`accept`, `walk_away`); the engine handles a player accepting or declining before the voice is asked. Fallbacks are logged at `warn` with the action kind and the error code only.

### 8. Opening offer
`OpeningOfferCalculator.offer(pitch, state)` returns `{ investment: min(pitch.askAmount, state.budget), equity: state.maxEquity }`. This is the tutor's "€500k for 30%" with a 30% maximum. It lives in `game/` with the policy because it is a rule about numbers, not about words.

## Risks / Trade-offs

- **[Risk]** Strict number checks with small local models cause frequent fallbacks, and template lines feel robotic. → The retry message names the exact numbers; fallbacks are flagged, so the insights panel and logs show how often they happen; the thresholds can be loosened later if needed.
- **[Risk]** The opening anchors at `maxEquity`, which reveals one hidden number. → This is inherent in "anchor high", and the tutor's example does the same. The budget and minimum stay hidden.
- **[Trade-off]** Two thinking calls per turn (line and options) cost more than one combined JSON call. → They run in parallel, and keeping them separate lets the line be free text (better prose on small models) while the options stay strict JSON.
- **[Trade-off]** Messages and leverage options can only use numbers in play, which forbids a creative "mention our €18k MRR" unless €18k is in the pitch. → This keeps every visible number grounded. The player can still write anything in free text.
