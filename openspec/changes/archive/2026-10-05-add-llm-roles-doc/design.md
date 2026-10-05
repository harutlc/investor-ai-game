## Context

See `proposal.md` (Why). The facts the document needs already exist; this change gathers them in one place.

| Source | What `LLM.md` takes from it |
| --- | --- |
| `homework-en.md` | The brief's "two LLMs": the decision LLM is the brain, the regular LLM is the voice |
| `README.md` → LLM providers, Investor brain, Investor voice, Game engine, Configuration | Provider list, question sets, the number check, fallbacks, errors, health, env variables |
| `openspec/specs/decision-llm`, `thinking-llm`, `investor-brain`, `investor-voice` | The exact rules; the document links to these instead of repeating them |
| `config/app.config.json` → `llm` | Active defaults: thinking `ollama` (`qwen2.5:3b`), decision `laya` (`english`), `minConfidence` 0.55, timeouts (thinking 60 s, decision 10 s), retries |
| `apps/api/src/llm/{decision,thinking}/` | The two provider interfaces and their implementations (Laya and Jev both go through `SystemOneDecisionProvider` and the `@typesafe-ai/sdk` client) |
| `apps/api/src/brain/`, `apps/api/src/voice/` | Where each model is called during a turn: `InvestorBrain.understand`/`evaluate`, and `InvestorVoice.open`/`respond`/`close` |

What the code does today, per turn:
- **Free-text move:** Stage A sends 2 concurrent decision requests (`intent`, `offer`).
- **Every move that is not dismissed:** Stage B sends `deal`, plus `conduct` when the move has text, concurrently.
- **Then code decides:** the policy picks the action and the numbers.
- **Then the thinking LLM writes**, concurrently, the investor's line (retried once if a number is wrong, else a template line) and, while the game goes on, the player's options (JSON).
- **Opening and closing:** the opening calls only the thinking LLM (line and options). A player's accept calls only the thinking LLM (a closing line, no options).

## Goals / Non-Goals

**Goals:**
- The reader can answer, for each kind of LLM, five questions:
  - what is its job;
  - what does it receive;
  - what does it return;
  - what is it never allowed to do;
  - what happens when it fails?
- Explain the roles first in plain words, then give the technical detail, so a tutor and a developer can both use it.
- Every statement traces to the code, the config or a spec.

**Non-Goals:**
- Not a setup guide. Install commands, the full env-variable table and the dev playground stay in the README; `LLM.md` links to them.
- Does not replace the four specs. It explains them and links to them.
- Does not cover the non-LLM parts (the negotiation policy maths, the HTTP API, the web UI), except as "code decides" boxes in the flow.
- No recommendations or comparisons of models beyond what the project configures.

## Decisions

**1. One file at the root: `LLM.md`.**
`PRD.md`, `README.md` and `TASKS.md` already live at the root, so a reader finds it there.
- Alternative: a `docs/` folder. Rejected, because one more file does not justify a new folder.
- Alternative: a longer README section. Rejected, because the README is already about 38 KB and mostly about setup.

**2. Layered structure: roles first, then reference.**
1. **The two roles in one page:** the brain, the voice and the game master. One sentence each on what each does and does not do, a turn-flow diagram, and the side-by-side comparison table.
2. **Decision LLM:**
   - its role and limits;
   - the question types (`choice`, `noul`, `score`);
   - the Stage A and Stage B question sets as a table;
   - the state it receives, including the hidden numbers, and why only this model sees them;
   - confidence and `uncertain`;
   - how the policy uses the answers;
   - failure (`PROVIDER_UNAVAILABLE`/`PROVIDER_BAD_RESPONSE`, the turn is refused, the game is unchanged);
   - `decision_logs` and Brain insights.
3. **Thinking LLM:**
   - its role and limits;
   - the four outputs (opening, reply per policy action, closing, player options as JSON);
   - prompt contents: persona, tone, startup, the last 8 messages, the decided numbers;
   - what is kept out of prompts: hidden numbers; player text is wrapped in `<player_message>`/`<player_pitch>` and marked untrusted;
   - the number check, one retry, then the template fallback;
   - how player options are validated (labels rewritten, invented numbers dropped, Accept and Walk away always added);
   - failure: the turn still completes.
4. **Providers:**
   - one table per kind: Laya vs Jev, Ollama vs Anthropic (hosted or local, key, default model, notable behaviour);
   - the fake providers;
   - switching providers with `THINKING_PROVIDER`/`DECISION_PROVIDER`;
   - health checks;
   - Jev and Laya confidences are not comparable.
5. **Extending:** adding a question set, or adding a provider behind the interface. A short pointer each.

**3. Plain-text diagram, not Mermaid.**
`TASKS.md` and the homework already use plain-text diagrams, which render in every viewer and in a terminal. The turn flow:

```
player move → [decision LLM: Stage A] → [decision LLM: Stage B] → code → [thinking LLM] → player
```

It is drawn with the parallel requests shown side by side, as in `TASKS.md` §1.1.

**4. Link instead of duplicating; fix the one mismatch.**
`LLM.md` explains behaviour and links to the README for commands and to the specs for exact rules. Defaults such as model names, timeouts and the confidence threshold are quoted with "(default, from `config/app.config.json`)", so a reader knows where the live value is. The README's `ollama pull llama3.1:8b` contradicts the configured `qwen2.5:3b`. The config is what runs, so the README is corrected.

**5. Use the project's own terms, and give the user's terms once.**
The codebase says "thinking provider" and "decision provider". The homework says "regular LLM" and "decision LLM". The document uses **decision LLM** and **thinking LLM** in headings, notes once that the thinking LLM is the homework's "regular LLM", and uses the code names (`DecisionProvider`, `ThinkingProvider`) only in the reference parts.

## Risks / Trade-offs

- [The document drifts from the code] → Each section ends with a "Source of truth" line naming its spec and its folder under `apps/api/src/`. A change to providers or question sets should update `LLM.md` in the same change.
- [It overlaps with the README "LLM providers" section] → The README keeps the setup commands and gains a one-line pointer to `LLM.md` for the explanation. The README is not trimmed in this change: removing working setup docs is out of scope and riskier than a small overlap.
- [Quoted defaults go stale] → Defaults are always attributed to `config/app.config.json`, so a reader checks there for the live value.
- [Model names age quickly (e.g. `claude-opus-5-5`, `qwen2.5:3b`)] → They appear only in the provider tables, as "configured default".
