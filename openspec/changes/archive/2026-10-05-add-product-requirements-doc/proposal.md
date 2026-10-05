## Why

The game works end to end, but everything written about it is aimed at engineers. The README covers setup, the API and security; `TASKS.md` is a build plan; the 18 OpenSpec capabilities are system contracts. Nothing tells a non-technical reader (a tutor, a product person, a playtester) what the product is, who it is for, what a player can do, and what "done" means. This change adds one plain-language product requirements document (PRD) that describes the game as it is today.

## What Changes

- Add a single PRD file, `PRD.md`, at the repository root, next to `README.md` and `TASKS.md`.
- The PRD describes the **current, working** product in non-technical language:
  - product summary, problem and goals
  - target users
  - the six investor personalities and how they differ
  - the player journey (Setup → Negotiation → Debrief), screen by screen
  - functional requirements, written as user-facing behavior
  - game rules: opening offer, the three ways to reply, how a game ends, the turn limit
  - fairness and trust rules: hidden investor limits, numbers that the AI cannot change, the "brain insights" view
  - non-functional expectations: responsiveness, availability when an AI service is down, privacy (no accounts)
  - success metrics, out-of-scope items, and future ideas (the `[v2]`/`[v3]` items in `TASKS.md` that are not built)
- Link the PRD from the first paragraph of `README.md`.
- No code, API, config or behavior changes.

## Capabilities

### New Capabilities

None. The PRD is documentation, and it describes behavior that the existing specs already cover. The change sets `skip_specs: true`.

### Modified Capabilities

None.

## Impact

- **New file:** `PRD.md` (repository root).
- **Edited file:** `README.md` (one link in the introduction).
- **Code, APIs, dependencies, deployment:** none.
- **Risk:** the PRD can drift from the code over time. The design names the sources it is written from, so later changes know what to update.
