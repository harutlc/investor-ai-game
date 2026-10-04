# Code Review: Investor Negotiation Game

- **Date:** 2026-10-04
- **Commit reviewed:** `666abf4` (branch `main`)
- **Scope:** `apps/api`, `apps/web`, `packages/shared`, `config/`
- **Checks run:** `pnpm -r test` (696 tests pass: api 518, web 84, shared 94), `pnpm typecheck` and `pnpm lint` (both clean). One throwaway probe test confirmed M1 and was then deleted.

Severity scale: **Critical** (fix before any deployment), **High**, **Medium**, **Low**.

---

## 1. Executive Summary

This is a well-built codebase. The layers are cleanly separated (controller → service → repository) and objects are wired by hand in one `Container`. Everything at the edges goes through zod:

- requests are validated with strict schemas (unknown fields are rejected);
- DB JSON columns are checked on write and re-checked on read;
- DTOs are strict, so a hidden investor number can't leak by accident.

Every game lookup is scoped to its owner (`findForPlayer(id, playerId)`), so there's no way to read another player's game. All queries go through Drizzle with parameters, and there are no XSS sinks in the web app. A turn's writes happen in one transaction, guarded by both an in-process `TurnLock` and an `expectedTurn` check. Key LLM safeguards are already in place: code makes the deal decisions, the model only phrases them, and a checker verifies the numbers in what it writes.

There are **no classic OWASP Critical findings** (no injection, no ownership bypass, no auth bypass). The main risks are about **operations and cost, not code correctness**:

1. Production safety depends on `NODE_ENV` being set, and nothing sets it.
2. Anonymous users can trigger unlimited paid LLM calls.
3. The anonymous-session design writes a DB row for every request that arrives without a cookie.

### Findings at a glance

| ID  | Severity | Area        | Summary                                                                   |
| --- | -------- | ----------- | ------------------------------------------------------------------------- |
| H1  | High     | Security    | Production mode is opt-in; `pnpm start` runs in dev mode (open LLM proxy) |
| H2  | High     | Security    | Anonymous users can trigger unlimited paid LLM calls                      |
| M1  | Medium   | Scalability | Every cookieless request inserts a `players` row (verified)               |
| M2  | Medium   | Bug         | Free text can end the game irreversibly on a model misreading             |
| M3  | Medium   | Performance | Turns have no deadline and keep running after the client disconnects      |
| M4  | Medium   | Deployment  | `trust proxy: false` + in-memory limiter                                  |
| L1  | Low      | Performance | Game list unpaginated, parses every row in full                           |
| L2  | Low      | Security    | Prompt delimiter tags are not escaped                                     |
| L3  | Low      | Bug         | When the player accepts, the voice is told the founder made the offer     |
| L4  | Low      | Bug         | Decision logs from failed turns duplicate turn numbers                    |
| L5  | Low      | Security    | Public health endpoint reports provider status                            |
| L6  | Low      | Game design | Insights reveal the investor's live judgments during play                 |
| L7  | Low      | Robustness  | Playground schema measurement recurses without bound                      |
| L8  | Low      | Quality     | Non-null assertions where a checked helper exists                         |
| L9  | Low      | Quality     | Duplicated helpers (offer mapping, UUID regex, column parser)             |
| L10 | Low      | Quality     | Two different `HISTORY_LIMIT` constants                                   |
| L11 | Low      | Frontend    | No fetch timeout                                                          |
| L12 | Low      | Frontend    | Client CSRF flag has to be set by hand to match the server                |
| L13 | Low      | Frontend    | Inline script in `index.html` will need a CSP hash                        |

---

## 2. Critical Vulnerabilities & Bugs

### H1: Production mode is opt-in, and `pnpm start` doesn't opt in

- **Severity:** High
- **Where:**
  - `apps/api/package.json:9` (`"start": "node dist/main.js"`)
  - `apps/api/src/config/ConfigLoader.ts:91` (`nodeEnv: env.NODE_ENV ?? 'development'`)
  - `config/app.config.json` (`"dev": { "playground": true }`)
  - `apps/api/src/container/Container.ts:222` (the playground is gated only on `!config.isProduction`)
- **Problem:** A deployment that forgets `NODE_ENV=production` silently runs in development mode. That means:
  - **The playground is mounted.** `POST /api/dev/thinking/text` accepts any system prompt (up to 8,000 chars) plus 20 × 4,000-character messages. That is an open proxy to your paid Anthropic key for anyone who has a session cookie, and cookies are free.
  - Cookies have no `Secure` flag and no `__Host-` prefix.
  - No HSTS header is sent.
  - Internal error messages are returned to clients (`ErrorHandlerMiddleware.ts:73`).
- **Fix:** Fail closed.

  ```jsonc
  // apps/api/package.json
  "start": "NODE_ENV=production node dist/main.js"
  ```

  ```jsonc
  // config/app.config.json: default off; local dev turns it on with an env override (e.g. PLAYGROUND=true in .env)
  "dev": { "playground": false }
  ```

  Optionally, make `ConfigLoader` refuse to start when `NODE_ENV` is unset and the process isn't running under `tsx`/vitest.

### H2: Anonymous users can trigger unlimited paid LLM calls ("denial of wallet")

- **Severity:** High
- **Where:** `apps/api/src/http/middleware/RateLimiters.ts:8-37`, `apps/api/src/game/GameEngine.ts:84` (`startGame`), `:135` (`playTurn`)
- **Problem:** Identity is free: no cookie means a new player. Each turn can make about 6 model calls (Stage A, Stage B, the line plus one regeneration, the options plus one JSON retry), and each provider SDK retries on top of that. Each new game makes 2-4 more. The only brake is a per-IP limit of 60 state-changing requests per 15 minutes, held in memory. There's no global concurrency cap, no per-player game cap and no spend circuit-breaker, so many IPs (or IPv6 rotation) multiply the cost linearly.
- **Fix:**
  - Add a process-wide semaphore around thinking and decision calls (for example, at most N in flight; excess requests get 503 `PROVIDER_UNAVAILABLE`).
  - Cap games per player per day (for example, a count query in `startGame`).
  - Keep a daily token/cost budget; once it's exhausted, use `FallbackLines` and the code-built options.
  - Move rate limiting to a shared store (`rate-limit-redis`) before running more than one instance.

### M1: Every cookieless request inserts a `players` row, and rows are never deleted

- **Severity:** Medium (verified)
- **Where:** `apps/api/src/http/ApiServer.ts:72`, `apps/api/src/http/middleware/PlayerSessionMiddleware.ts:34`, `apps/api/src/services/PlayerService.ts:29-31`
- **Problem:** `PlayerSessionMiddleware` runs on every request after the health route, including 404s, crawler hits and `/robots.txt`. A probe sending 50 cookieless GETs to unknown routes created **50 player rows**. Nothing ever deletes them, so the table grows with bot traffic. A write per request also adds load on SQLite's single writer.
- **Fix:** Create players lazily. Only _resolve_ an existing player on reads, and _create_ one only when it's needed (`POST /api/games`):

  ```ts
  // PlayerSessionMiddleware
  const existing = this.players.find(verifiedId);
  if (!existing && req.method === 'GET') {
    next(); // controllers treat a missing player as "no games"
    return;
  }
  ```

  Also add a periodic prune:

  ```sql
  DELETE FROM players
  WHERE last_seen_at < :cutoff
    AND id NOT IN (SELECT player_id FROM game_sessions);
  ```

### M2: Free text can end the game irreversibly on a model misreading

- **Severity:** Medium
- **Where:** `apps/api/src/game/MoveResolver.ts:97-98`
- **Problem:** If Stage A reads `accept` or `decline` with confidence ≥ 0.55 (`minConfidence`), the game ends at once (`deal` or `rejected_by_player`). A message like _"I can't accept 30% — would you do 20%?"_ is a plausible misclassification, and there's no undo.
- **Fix:** Don't end the game from free text. Answer with a `clarify` turn whose options include explicit "Accept €X for Y%" and "Walk away" buttons; those already end the game safely through `fromOption`. Alternatively, use a much higher confidence threshold for game-ending intents.

---

## 3. Performance & Scalability Bottlenecks

### M3: Turns have no overall deadline and keep running after the client leaves

- **Severity:** Medium
- **Where:** `apps/api/src/game/GameEngine.ts:135-170`, provider settings in `config/app.config.json`
- **Problem:** Worst case, computed from the current config:

  | Thinking provider                                             | Stage A + B (decision: 3 × 10 s each) | Voice (line and options run in parallel) | Turn total |
  | ------------------------------------------------------------- | ------------------------------------- | ---------------------------------------- | ---------- |
  | Ollama (2 attempts × 60 s per call, line regenerated once)    | 60 s                                  | 240 s                                    | **~300 s** |
  | Anthropic (3 attempts × 60 s per call, line regenerated once) | 60 s                                  | 360 s                                    | **~420 s** |

  Most reverse proxies give up at 60 s. The `TurnLock` stays held, so the user's retry gets a 409 `TURN_IN_PROGRESS`, and the abandoned turn keeps spending tokens because nothing cancels it.

- **Fix:** Give each turn one `AbortSignal` and pass it through `ThinkingRequest` and `DecisionRequest` to the SDKs (both accept a `signal`):

  ```ts
  // GameController.turn
  const clientClosed = new AbortController();
  req.on('close', () => clientClosed.abort());
  const signal = AbortSignal.any([AbortSignal.timeout(45_000), clientClosed.signal]);
  await this.engine.playTurn(playerId, params.id, body, { signal });
  ```

  Once the budget runs out, use the existing fallbacks (`FallbackLines`, `midpointCounter`) instead of retrying again.

### M4: `trust proxy: false` with an in-memory rate limiter

- **Severity:** Medium (deployment)
- **Where:** `config/app.config.json` (`server.trustProxy: false`), `apps/api/src/http/middleware/RateLimiters.ts:8`
- **Problem:** Behind any load balancer, every user shares the proxy's IP, so 300 requests per 15 minutes is the limit for _everyone combined_. The limiter's state also resets on restart and isn't shared between instances.
- **Fix:** Set `trustProxy` to the exact number of proxy hops in production (never `true`, which lets clients spoof `X-Forwarded-For`), and use a shared store.

### L1: The game list loads and parses every column for every game

- **Severity:** Low
- **Where:** `apps/api/src/repositories/GameSessionRepository.ts:79-87`
- **Problem:** `listForPlayer` selects every column and runs zod over `investorState`, `pitch` and `playerOptions` for every game, with no limit. The summary only needs a few fields.
- **Fix:** Add a `listSummariesForPlayer(playerId, { limit, before })` that selects only the summary columns (`id`, `persona_id`, `pitch->name`, `status`, `turn`, `current_investor_offer`, timestamps) and pages with a cursor on `(created_at, rowid)`. The existing `game_sessions_player_created_idx` index already covers this.

---

## 4. Code Quality & Maintainability Improvements

### Backend

| ID  | Sev | Where                                                                                                                                                                      | Problem                                                                                                                                                                                                                                                                                       | Fix                                                                                                                                                                      |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L2  | Low | `apps/api/src/voice/PromptBuilder.ts:90, 112`                                                                                                                              | Player text is wrapped in `<player_message>` / `<player_pitch>` tags but not escaped, so typing `</player_message>` breaks out of the wrapper. Impact is limited because code makes the decisions and `NumberConsistencyChecker` checks the numbers, but the wrapper is weaker than it looks. | Escape `<` and `>` (or remove the tag names) in player text before wrapping it.                                                                                          |
| L3  | Low | `apps/api/src/game/GameEngine.ts:195-198` + `apps/api/src/voice/PromptBuilder.ts:12`                                                                                       | When the **player** accepts the investor's offer, the voice gets the `accept` instruction "Accept the _founder's_ offer and close the deal", which tells the investor they are accepting the founder's offer.                                                                                 | Add a separate `player_accepted` line subject with its own instruction and fallback line.                                                                                |
| L4  | Low | `apps/api/src/game/GameEngine.ts:74` (acknowledged in its doc comment)                                                                                                     | Decision-log rows from turns that failed or lost a race stay in the log under a turn number that gets reused, so the insights panel shows duplicates.                                                                                                                                         | Tag log rows with a turn-attempt id and only show committed ones, or buffer the rows and write them inside the turn transaction (failures are still written right away). |
| L5  | Low | `apps/api/src/services/HealthService.ts:19-23`                                                                                                                             | The public `/api/health` reports provider reachability and process uptime.                                                                                                                                                                                                                    | In production, return only `status`; put the details behind an internal route or a token.                                                                                |
| L6  | Low | `apps/api/src/game/GameSessionService.ts:45`, `apps/web/src/pages/NegotiationPage.tsx:41`                                                                                  | Insights show the investor's live `accept`, `good_deal` and `reaction` answers _while the negotiation is running_, so a player can probe toward acceptance.                                                                                                                                   | If that's intended for teaching, keep it. Otherwise only serve insights for finished games (`status !== 'negotiating'`).                                                 |
| L7  | Low | `apps/api/src/http/controllers/PlaygroundController.ts:72, 83`                                                                                                             | `measure()` walks the whole client schema before checking depth, so deeply nested JSON (fits in 100 kb) throws a stack overflow and returns a 500. Dev-only.                                                                                                                                  | Stop recursing once `depth > MAX_SCHEMA_DEPTH`.                                                                                                                          |
| L8  | Low | `apps/api/src/game/GameEngine.ts:183, 246`                                                                                                                                 | `session.currentInvestorOffer!` uses a non-null assertion, while `MoveResolver.currentOffer()` already enforces the same rule with a clear error.                                                                                                                                             | Use `MoveResolver.currentOffer(session)` (or a stored-offer equivalent).                                                                                                 |
| L9  | Low | `GameEngine.ts:152` and `GameSessionService.ts:53`; `PlayerService.ts:12` and `RequestIdMiddleware.ts:4`; `GameSessionRepository.ts:120` and `DecisionLogRepository.ts:55` | Duplicated code: the `StoredOffer → Offer` mapping, the UUID regex and the `column()` JSON parse helper each appear twice.                                                                                                                                                                    | Extract shared helpers: `OfferRepository.toOffer()`, an `isUuid()` util, and a `parseJsonColumn(table, column, id, schema, value)` helper.                               |
| L10 | Low | `apps/api/src/voice/PromptBuilder.ts:6` vs `apps/api/src/brain/NegotiationStateBuilder.ts:8`                                                                               | Two exported constants named `HISTORY_LIMIT` with different meanings (8 chat messages vs 10 offers).                                                                                                                                                                                          | Rename to `PROMPT_HISTORY_MESSAGES` and `STATE_HISTORY_OFFERS`.                                                                                                          |

### Frontend / web

| ID  | Sev | Where                                   | Problem                                                                                                                                                                                   | Fix                                                                                                                                                                                                                                                                                                               |
| --- | --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L11 | Low | `apps/web/src/api/GameApiClient.ts:115` | `fetch` has no timeout, so together with M3 the UI can show "is typing…" for minutes.                                                                                                     | Pass `signal: AbortSignal.timeout(60_000)` and map the timeout to a specific "the investor is taking too long" message in `ErrorMessages`.                                                                                                                                                                        |
| L12 | Low | `apps/web/src/api/GameApiClient.ts:57`  | The client's CSRF flag (`VITE_CSRF_ENABLED`) has to be set to match the server's `CSRF_ENABLED` by hand. If the server has CSRF on and the client doesn't, every mutation fails with 403. | `CsrfTokenStore` already treats a 404 as "CSRF off", so always construct the client with `csrf: true` and drop the env flag. Also enable CSRF in production: `SameSite=Lax` plus `JsonContentTypeGuard` does block cross-site posts, but it doesn't protect against sibling subdomains, which count as same-site. |
| L13 | Low | `apps/web/index.html:9`                 | Whenever the static host gets a CSP, the inline theme script will need a hash (`'sha256-…'`). No CSP is defined for the SPA host yet.                                                     | Define a CSP for the web host that includes the script's hash, or move the script into a small external file.                                                                                                                                                                                                     |

**Accessibility:** the basics are good: `role="log"` with `aria-live="polite"` for the transcript, screen-reader-only speaker labels, `aria-busy` loading skeletons, Radix sheets with titles and descriptions, and visible `focus-visible` outlines.

### Strengths worth keeping

- Strict response schemas on both server (`GameSessionMapper`) and client (`GameApiClient.parse`), a solid two-sided guard against hidden-state leaks.
- Every game lookup is scoped to its owner in the repository layer, not just in controllers.
- "Select, don't generate" for numbers: `OfferCandidateExtractor` finds the numbers in code, and the model only picks among them.
- The turn's model calls all finish before anything is written, then one transaction writes everything, with an optimistic `expectedTurn` check.
- Logs redact cookies, authorization and CSRF headers; failed decision calls store only an error code, never the message.

---

## 5. Actionable Recommendations (prioritized)

1. [ ] **H1:** Make production mode fail closed: the start script sets `NODE_ENV=production`, and the playground is off by default.
2. [ ] **H2:** Add a global LLM concurrency cap, a per-player daily game cap and a spend circuit-breaker.
3. [ ] **M3:** Give each turn a deadline `AbortSignal`, pass it through every provider, and cancel on client disconnect.
4. [ ] **M1:** Create players lazily and prune orphaned player rows.
5. [ ] **M2:** Require an explicit option click before free text can end the game.
6. [ ] **M4:** Set `trustProxy` per deployment and use a shared rate-limit store.
7. [ ] **L12:** Enable CSRF in production and remove the client-side flag.
8. [ ] **L1:** Paginate the game list and slim its query.
9. [ ] **L2, L3:** Escape player text in prompts and fix the accept-line wording.
10. [ ] Then the remaining Low items: L4-L11, L13.
