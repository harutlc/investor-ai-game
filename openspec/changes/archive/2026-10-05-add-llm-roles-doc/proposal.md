## Why

The game runs on two kinds of AI model with very different jobs:
- a **decision LLM** (Laya or TypeSafe's Jev) is the investor's brain;
- a **thinking LLM** (Ollama or Anthropic) is the investor's voice.

This split is the core idea of the homework, but there is no single place that explains it. It is spread over:
- the README ("LLM providers", "Investor brain", "Investor voice", "Configuration");
- four OpenSpec capabilities (`decision-llm`, `thinking-llm`, `investor-brain`, `investor-voice`);
- a few paragraphs of `PRD.md`.

A reviewer or a new developer has to read all of them to answer "what does each model do, what does it see, and what happens when it fails?". One focused document fixes that.

## What Changes

- Add `LLM.md` at the repository root, next to `PRD.md`. It covers only the two kinds of LLM:
  - **Roles:** the brain/voice/game-master split, and a turn-by-turn picture of when each model is called.
  - **Decision LLM:** its role and what it is never allowed to do; the three question types; the questions it is asked in Stage A and Stage B; confidence and "uncertain" answers; what state it receives; how it fails; logging and Brain insights.
  - **Thinking LLM:** its role and what it is never allowed to do; the four kinds of text it writes (opening, reply, closing, player options); what goes into its prompts and what is kept out; the number check, the retry and the fallback lines; how it fails.
  - **Providers:** Laya vs Jev and Ollama vs Anthropic (hosted or local, keys, models, notable behaviour), the fake providers, and how to switch between them.
  - **Side-by-side comparison** of the two kinds of LLM.
- Link `LLM.md` from `README.md` (next to the PRD link, and from the "LLM providers" section) and from `PRD.md` ("How it works").
- Fix one mismatch the investigation found. The README's Ollama setup pulls `llama3.1:8b`, but `config/app.config.json` uses `qwen2.5:3b`. The README is corrected to the configured model.
- No code, config, API or behaviour changes.

## Capabilities

### New Capabilities

None. This is documentation of behaviour that the `decision-llm`, `thinking-llm`, `investor-brain` and `investor-voice` specs already define, so the change sets `skip_specs: true`.

### Modified Capabilities

None.

## Impact

- **New file:** `LLM.md`.
- **Edited files:** `README.md` (links, and the Ollama model name in the setup snippet) and `PRD.md` (one link).
- **Code, APIs, dependencies, deployment:** none.
- **Risk:** the new document repeats facts that also live in the README and the specs, so it can drift. See design.md for how this is contained.
