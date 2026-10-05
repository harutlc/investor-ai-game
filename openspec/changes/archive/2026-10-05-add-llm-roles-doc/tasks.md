## 1. Confirm the facts

- [x] 1.1 Re-read the sources in design.md (Context table) and list, for each kind of LLM: its job, its inputs, its outputs, what it must never do, its failure behaviour, and the configured defaults (provider, model, timeout, retries, `minConfidence`). Verify: every item points to a file (code, config or spec), and the per-turn call pattern in design.md matches `InvestorBrain.ts`, `InvestorVoice.ts` and `GameEngine.ts`.
- [x] 1.2 Watch both models during a real turn: start the API with the fake providers (`THINKING_PROVIDER=fake DECISION_PROVIDER=fake pnpm dev`), play an opening, a free-text move and an option move, then read `GET /api/games/:id/insights`. Verify: Stage A entries appear only for the free-text turn, Stage B entries for every judged turn, and none for the opening. Correct the 1.1 list (not the code) on any mismatch.

## 2. Write LLM.md

- [x] 2.1 Create `LLM.md` at the repository root with a title, a "Last updated" line and the five parts from design.md (Decision 2). Verify: the file exists and every part heading is present.
- [x] 2.2 Write part 1 (the two roles): brain / voice / game master in plain words, the turn-flow diagram (plain text, parallel requests side by side), and the side-by-side comparison table (job, input, output, sees hidden numbers?, never does, on failure, timeout, retries). Verify: a reader can answer the five questions from design.md's goals for both kinds of LLM from this part alone.
- [x] 2.3 Write part 2 (decision LLM): question types, the Stage A and B question-set table, the state and why only this model sees hidden numbers, confidence and `uncertain`, how the policy uses the answers, failure, `decision_logs` and Brain insights, and a "Source of truth" line. Verify: the question names and options match `apps/api/src/brain/questions/*.ts`.
- [x] 2.4 Write part 3 (thinking LLM): the four outputs, what goes into prompts and what is kept out, untrusted player text, the number check with one retry and then the template line, player-option validation, failure, and a "Source of truth" line. Verify: it agrees with the `investor-voice` spec, and `grep -nEi 'budget|minEquity|maxEquity'` finds these words only where the doc says they are kept out of prompts.
- [x] 2.5 Write part 4 (providers): the Laya vs Jev and Ollama vs Anthropic tables, the fake providers, switching with env variables, health, and the warning that Jev and Laya confidences are not comparable. Link to the README for install commands instead of copying them. Verify: every default quoted matches `config/app.config.json` and is attributed to it.
- [x] 2.6 Write part 5 (extending): add a question set, add a provider. A short pointer each, linking to the README and the specs. Verify: the class and file names mentioned exist (`StageAQuestionSet`, `StageBQuestionSet`, `Container`, `DecisionProviderFactory`, `ThinkingProviderFactory`).

## 3. Link and fix

- [x] 3.1 In `README.md`: add a link to `LLM.md` in the introduction next to the PRD link and at the top of "LLM providers"; change the Ollama setup snippet from `llama3.1:8b` to the configured `qwen2.5:3b`. Verify: `grep -n 'llama3.1' README.md` returns nothing, and both links resolve.
- [x] 3.2 In `PRD.md` "How it works": add a link to `LLM.md`. Verify: the link resolves.
- [x] 3.3 Final pass: every relative link in `LLM.md` points to an existing file (check with a short script), and `pnpm exec prettier --check LLM.md README.md PRD.md` passes.
