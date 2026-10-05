## 1. Gather facts

- [x] 1.1 Re-read the sources in design.md (Context table). List the player-visible facts: the six personas' public profiles, the pitch fields, the 15-turn limit, the three reply modes, the investor's responses (accept, counter, reject, clarify, dismiss, walk away), the four end states and their on-screen wording, and what each screen shows. Verify: every fact on the list points to a file and section.
- [x] 1.2 Check the facts in the running game: start it with the fake providers (`THINKING_PROVIDER=fake DECISION_PROVIDER=fake pnpm dev` and `pnpm dev:web`), then play one game to a deal and one to a walk-away. Verify: the screens, labels and end states match the list from 1.1; fix any mismatch in the list, not in the code.

## 2. Write the PRD

- [x] 2.1 Create `PRD.md` at the repository root with the 12-section outline from design.md (Decision 3), a title, a "Last updated: <date>" line and a "Sources" list. Verify: the file exists and every section heading is present.
- [x] 2.2 Write Overview, Problem and goals, and Target users, in plain language, explaining "brain, voice, game master" as an analogy. Verify: no class names, API routes, config keys or model names appear in these sections.
- [x] 2.3 Write the Investor personalities table from the public profiles (name, tagline, traits, a qualitative description). Verify: the PRD contains none of the hidden numbers (budget, minimum/maximum equity, patience, concession step); grep `PRD.md` for the persona budgets (`600`, `900`, `500`, `700`, `650`, `750` thousand) and equity limits.
- [x] 2.4 Write User journey and Functional requirements as numbered FR-n items grouped by Setup, Negotiation and Debrief. Each group links to its OpenSpec capability (`web-ui`, `game-engine`, `negotiation-policy`, `investor-voice`, `investor-personas`). Verify: each FR traces to an item on the 1.1 fact list, and every linked spec path exists.
- [x] 2.5 Write Game rules, and Fairness and trust (hidden limits, numbers checked against the decision, in-character replies to manipulation attempts, Brain insights). Verify: the rules agree with the README sections "Negotiation policy", "Investor voice" and "Game engine".
- [x] 2.6 Write Non-functional requirements and Success metrics, with each metric labelled "proposed target" (design Decision 5). Verify: no metric claims a measured value.
- [x] 2.7 Write Out of scope and future ideas, from the `[v2]`/`[v3]` items in `TASKS.md` §1, under a "Not built yet" heading; then the Glossary and a short "How it works" note that names the AI models once. Verify: every feature whose flag is `false` in `config/app.config.json` appears only in this section.

## 3. Link and review

- [x] 3.1 Add a link to `PRD.md` in the first paragraph of `README.md`. Verify: the link opens the file in a Markdown preview.
- [x] 3.2 Do a final readability pass as a non-technical reader: plain language, terms defined in the Glossary, a 10–15 minute read (roughly 2,000–3,500 words). Verify: `wc -w PRD.md` is in range, and `pnpm exec prettier --check PRD.md README.md` passes.
