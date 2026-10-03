## Why

The investor NPC needs two kinds of model. A **decision LLM** (Jev or Laya) is the investor's brain: it returns typed judgments (choice, noul, score). A **thinking LLM** (Ollama or Anthropic) is the investor's voice: it writes replies and the player's options. Every later feature (the investor brain, dialogue, the game engine) depends on calling these models through one stable interface, with the provider chosen by configuration rather than by code. Without that layer each feature would re-implement HTTP calls, retries, timeouts and JSON parsing.

## What Changes

- **Thinking LLM layer**:
  - A `ThinkingProvider` contract with `generateText` and `generateJson` (zod-validated). `generateJson` retries once on invalid JSON.
  - Implementations:
    - **Ollama**, through the official `ollama` client. JSON mode sends a JSON Schema in `format`.
    - **Anthropic**, through `@anthropic-ai/sdk`. JSON mode uses structured outputs. Server-side refusal fallback is on by default.
    - **Fake**, scripted, for tests and offline UI work.
- **Decision LLM layer**:
  - A `DecisionProvider` contract with `decide` and `decideMany`, supporting `choice`, `noul` and `score` questions.
  - Answers are normalized into provider-neutral types (value, confidence, probabilities) plus latency and usage.
  - Implementations:
    - **Jev** (hosted TypeSafe API) and **Laya** (self-hosted `laya-serve`). Laya is wire-compatible with Jev, so both use the official `@typesafe-ai/sdk` client with different base URL, key and model settings.
    - **Fake**, deterministic or scripted.
- **Configuration**:
  - A new `llm` section in `config/app.config.json` with `thinking` and `decision` blocks. Each block names its active `provider` and holds per-provider settings (base URL, model, timeouts, retries, sampling).
  - Environment variables override the active providers (`THINKING_PROVIDER`, `DECISION_PROVIDER`) and the endpoints (`OLLAMA_BASE_URL`, `LAYA_BASE_URL`), and supply the keys (`ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, `LAYA_API_KEY`).
  - Startup fails with a clear message when the active provider is unknown or its required key is missing.
- **Factories**: one per kind, building the configured provider. Adding a provider means one class plus one factory entry.
- **Errors**:
  - Provider failures map to the existing error envelope with two new codes: `PROVIDER_UNAVAILABLE` (503: unreachable, timeout, rate-limited) and `PROVIDER_BAD_RESPONSE` (502: invalid output after retry, or refusal).
  - Secrets never appear in logs or responses.
- **Health**: `GET /api/health` adds `checks.thinking` and `checks.decision` (`ok` / `error`). Results are cached briefly, and provider names stay out of the response. Only the database decides 200 vs 503 (**modifies** the health requirement).
- **Dev playground API**: `POST /api/dev/thinking/text`, `POST /api/dev/thinking/json` and `POST /api/dev/decision`, for trying the active providers by hand. These routes are mounted only when `dev.playground` is enabled and never in production. They run behind the existing session, CSRF and rate-limit middleware.
- **Docs**: README sections on running Ollama and laya-serve, using Jev and Anthropic, and switching providers.

Out of scope, for later changes: investor personas, question sets and the investor brain; dialogue and option generation; decision logging to the database (it needs game sessions); the confidence gate; in-process Laya (`laya-ts`, which isn't published on npm); and an OpenAI provider.

## Capabilities

### New Capabilities
- `thinking-llm`: text and schema-validated JSON generation through a configurable thinking provider (Ollama, Anthropic, fake), including config, env overrides, error mapping and reachability checks.
- `decision-llm`: typed System One judgments (choice, noul, score) through a configurable decision provider (Jev, Laya, fake), with normalized answers, parallel requests, config, env overrides, error mapping and reachability checks.
- `llm-playground`: dev-only HTTP endpoints for exercising the active thinking and decision providers.

### Modified Capabilities
- `api-foundation`: the health endpoint also reports thinking and decision provider reachability, without exposing provider identity, and without affecting the 200/503 status.

## Impact

- **New code**: `apps/api/src/llm/**` (contracts, providers, factories, errors, JSON parsing), playground controller, health changes, config schema and loader additions, `packages/shared` (new error codes and playground DTOs), tests, README.
- **Config**: new `llm` and `dev` sections in `config/app.config.json`, and new variables in `.env.example`.
- **Dependencies**: `@anthropic-ai/sdk`, `@typesafe-ai/sdk`, `ollama`.
- **External services** (optional at runtime): Ollama on `:11434`, laya-serve on `:8000`, the TypeSafe API, the Anthropic API. None of them are needed for tests (fake providers and stubbed HTTP).
- **API surface**: new `checks.thinking` and `checks.decision` fields in `/api/health`, and new dev-only `/api/dev/*` routes.
