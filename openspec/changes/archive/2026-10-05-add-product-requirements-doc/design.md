## Context

See `proposal.md` (Why) for the motivation. The facts the PRD needs are already in the repository, but they are written for engineers and spread across several files:

| Source | What the PRD takes from it |
| --- | --- |
| `homework-en.md` | The original brief: the problem, the tutor's example ("€500k for 30%"), the brain/voice idea |
| `TASKS.md` §1 | The game design, and which ideas are `[MVP]` (built) versus `[v2]`/`[v3]` (not built) |
| `README.md` (Investor personas → Web UI) | What the game does today: personas, turn flow, how a game ends, screens |
| `apps/api/src/personas/personaDefinitions.ts` | The six investors' names, taglines and character |
| `config/app.config.json` → `game` | Current rules: 15-turn limit, € currency, €2M default valuation; every `features` flag is `false` (phases, due diligence, deal terms, hidden facts, market events, scored debrief) |
| `apps/web/src/lib/StatusText.ts` | The words players see for each outcome ("Deal closed", "Investor walked away", "You walked away", "Out of turns") |
| `openspec/specs/*` | The detailed behavior contracts (18 capabilities); the PRD links to them for detail and does not repeat them |

What the game does today:
- The player picks one of six investors, describes a startup (name, sector, description, valuation, amount wanted) and negotiates in a chat.
- The investor opens with an offer.
- Each turn the player can click a suggested reply, send a precise offer (amount and equity), or type freely.
- The investor accepts, counters, rejects, asks for clarification, dismisses a manipulation attempt, or walks away.
- A game ends with a deal, a walk-away by either side, or after 15 turns.
- The debrief shows the outcome, the final terms and "Play again". There is no score yet.

## Goals / Non-Goals

**Goals:**
- A reader with no technical background can understand the whole product from one file in about 10–15 minutes.
- Every statement about current behavior can be traced to the sources above. Nothing is invented.
- Built features and future ideas are kept clearly apart.

**Non-Goals:**
- Not a replacement for the OpenSpec specs, `README.md` or `TASKS.md`. Those stay the technical source of truth.
- No setup instructions, API routes, config keys, class names, or provider/model names in the body text.
- No new product decisions. The PRD records the product; it does not redesign it.

## Decisions

**1. One file at the repository root: `PRD.md`.**
The user asked for a single file. The root already holds the other top-level documents (`README.md`, `TASKS.md`, `homework-en.md`), so a reader finds it there.
- Alternative considered: `docs/PRD.md`. Rejected because there is no `docs/` folder, and one file does not justify creating one.
- Alternative considered: a section inside `README.md`. Rejected because the README is a developer guide, and a non-technical reader would have to skip most of it.

**2. Describe the product as built, with future ideas in a separate, labelled section.**
The `[v2]` design in `TASKS.md` (phases, due diligence, bluffing, deal terms, trust, market events, scoring) is not built: every one of those feature flags is off. The PRD's requirements describe only working behavior. Future ideas go in a "Future scope" section, so a playtester never looks for a feature that does not exist.
- Alternative considered: a PRD of the full planned game, with status tags on each requirement. Rejected because the request was for a spec of the "already working project".

**3. Use a standard PRD outline, in plain language.**
Sections:
1. Overview: the one-paragraph pitch, and "brain, voice, game master" explained as an analogy
2. Problem and goals
3. Target users: students learning negotiation, tutors and reviewers of the homework, casual players
4. Investor personalities: a table of the six investors (name, nickname, what they are like), with no hidden numbers
5. User journey: Setup → Negotiation → Debrief
6. Functional requirements: numbered (FR-1, FR-2, …), each written as "The player can…" or "The investor…", grouped by journey step
7. Game rules: opening offer, the three ways to reply, possible investor responses, mood hints, how a game ends, the turn limit
8. Fairness and trust: the investor's limits stay secret, and the AI's words never change the numbers (the decision is made first, the text is checked against it); suspicious messages ("ignore your instructions…") are answered in character; "Brain insights" shows how each decision was made
9. Non-functional requirements: turn speed expectations, the game still working when the text AI is down, no accounts or personal data, light and dark theme, works in a desktop browser
10. Success metrics
11. Out of scope and future ideas
12. Glossary: equity, valuation, counter-offer, persona, and so on

**4. Explain technical ideas through what the player sees.**
"Decision model" becomes "the investor's judgement"; "LLM" becomes "the AI that writes the investor's words". Model names (Jev, Laya, Ollama, Claude) appear once, in a short "How it works" note at the end, because the homework brief names them and a reviewer will look for them.

**5. Write success metrics as targets, marked as proposed.**
The project collects no analytics, so measured values do not exist. Metrics are written as targets to observe in playtests, for example:
- the share of games that reach an outcome other than "out of turns"
- persona difference: the same pitch gets visibly different results against the shark and the angel
- no hidden number ever shown to the player
- a turn completes even when the text AI is unavailable

They are labelled "proposed", so nobody reads them as measured results.

## Risks / Trade-offs

- [The PRD drifts as the game changes] → It has a "Last updated" line and a short "Sources" list (the table in Context). A future change that alters player-visible behavior should update `PRD.md` in the same change.
- [Persona descriptions reveal the hidden numbers] → The persona table uses only the public profile (name, tagline, traits) plus a qualitative description such as "very short temper". The budgets and equity limits stay out, the same rule the game itself follows.
- [Plain language loses precision] → Each functional-requirement group links to the matching OpenSpec capability (e.g. `openspec/specs/negotiation-policy/spec.md`) for exact behavior.
- [Readers mistake future ideas for current features] → Future scope sits in its own section with a clear "Not built yet" heading. No FR refers to it.
