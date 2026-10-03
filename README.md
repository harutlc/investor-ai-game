# Investor Negotiation Game

The player pitches a startup to an AI investor and negotiates the deal. The game design and roadmap are in [`TASKS.md`](./TASKS.md); the homework brief is in [`homework-en.md`](./homework-en.md).

This README covers what exists so far: the monorepo, the Express API foundation and its security baseline, and the LLM provider layer. Game features are added on top of it in later changes.

## Prerequisites

- **Node.js ≥ 22.12** (tested with 24)
- **pnpm 10** (`corepack enable` picks up the version pinned in `package.json`)
- A C/C++ toolchain for the native SQLite driver (`better-sqlite3`). On macOS this is the Xcode Command Line Tools (`xcode-select --install`). Prebuilt binaries are used when one is available.

## Setup

```bash
pnpm install
cp .env.example .env
# generate the cookie secret (at least 32 characters)
echo "COOKIE_SECRET=$(openssl rand -base64 48)" >> .env
# only if you turn CSRF protection on (CSRF_ENABLED=true): a second, different secret
# echo "CSRF_SECRET=$(openssl rand -base64 48)" >> .env
pnpm dev                     # API on http://localhost:3001
curl -i http://localhost:3001/api/health
```

The SQLite database is created at `data/game.sqlite` on first start, and migrations run automatically.

## Scripts (run from the repo root)

| Script                      | What it does                                                            |
| --------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                  | Starts the API with hot reload (`tsx watch`)                            |
| `pnpm build`                | Compiles every package with `tsc -b` into `dist/`                       |
| `pnpm start`                | Runs the built API (`node apps/api/dist/main.js`)                       |
| `pnpm test`                 | Runs the Vitest suites in every package                                 |
| `pnpm typecheck`            | Type-checks sources and tests                                           |
| `pnpm lint` / `pnpm format` | ESLint (type-aware) / Prettier                                          |
| `pnpm db:generate`          | Generates a migration from `apps/api/src/db/schema.ts`                  |
| `pnpm db:migrate`           | Applies migrations with drizzle-kit (the API also does this on startup) |

## Layout

```
apps/api/            Express API
  src/config/        ConfigLoader, AppConfigSchema (zod), WorkspaceRoot
  src/container/     Container: manual dependency injection
  src/db/            Database (better-sqlite3 + Drizzle), schema.ts, migrations/
  src/repositories/  data access only
  src/services/      business logic
  src/http/          ApiServer, controllers/, middleware/
  src/errors/        AppError and one subclass per error
  src/llm/           LLM providers: thinking/ (Ollama, Anthropic, fake), decision/ (Jev, Laya, fake,
                     ConfidenceGate, DecisionLogger)
  src/game/          API-only game types (the investor's hidden state)
  src/personas/      investor personas: definitions, validation, catalog
  test/              Vitest + Supertest (in-memory SQLite)
packages/shared/     zod schemas and types shared with the future web app (game contracts, ValuationCalculator)
config/app.config.json   non-secret settings (committed)
.env                 secrets and overrides (git-ignored)
```

## Architecture

Requests flow **controller → service → repository**:

- **Controllers** handle HTTP only: validated input in, DTO out. Each one exposes `basePath` and `routes()`.
- **Services** hold the business rules and throw `AppError` subclasses.
- **Repositories** do data access through Drizzle and return plain records.

Everything is wired with constructor injection in `Container`, the one place where objects are created. Tests build the same container with an in-memory database (`test/support/createTestApp.ts`).

Every error response has the shape `{ "error": { "code", "message", "details"?, "requestId" } }`. The codes are listed in `ErrorCode` in `packages/shared`.

## Configuration

`config/app.config.json` holds non-secret settings. Environment variables (or `.env`) supply the secrets and can override some values:

| Variable            | Overrides / purpose                                               |
| ------------------- | ----------------------------------------------------------------- |
| `COOKIE_SECRET`     | **Required.** At least 32 characters                              |
| `CSRF_ENABLED`      | `security.csrf.enabled` (`true` / `false`; `false` by default)    |
| `CSRF_SECRET`       | Required only when CSRF is enabled; 32+ chars, not the cookie one |
| `NODE_ENV`          | `development` (default), `production` or `test`                   |
| `PORT`              | `server.port`                                                     |
| `CORS_ORIGINS`      | `cors.origins` (a comma-separated list of exact origins; no `*`)  |
| `DATABASE_FILE`     | `database.file` (relative to the repo root, or `:memory:`)        |
| `LOG_LEVEL`         | `logging.level`                                                   |
| `APP_CONFIG_PATH`   | Path to an alternative config file                                |
| `THINKING_PROVIDER` | `llm.thinking.provider` (`ollama`, `anthropic` or `fake`)         |
| `DECISION_PROVIDER` | `llm.decision.provider` (`laya`, `jev` or `fake`)                 |
| `OLLAMA_BASE_URL`   | `llm.thinking.providers.ollama.baseUrl`                           |
| `LAYA_BASE_URL`     | `llm.decision.providers.laya.baseUrl`                             |
| `ANTHROPIC_API_KEY` | Required when the thinking provider is `anthropic`                |
| `TYPESAFE_API_KEY`  | Required when the decision provider is `jev`                      |
| `LAYA_API_KEY`      | Optional; sent as a bearer token if your laya-serve requires one  |

Invalid configuration stops startup with a list of every problem. Secret values are never printed.

Game settings live in the `game` section and have no environment overrides:

| Key                          | Meaning                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `game.currency`              | `EUR` (the only supported value)                                         |
| `game.maxTurns`              | Turn limit per game (1–50, default 15)                                   |
| `game.defaultValuation`      | Pre-money valuation suggested for a new pitch (default €2,000,000)       |
| `game.features.*`            | v2 feature flags (`phases`, `dueDiligence`, …); all off until they exist |
| `llm.decision.minConfidence` | Decision answers below this confidence count as uncertain (default 0.55) |

## LLM providers

The investor uses two kinds of model:

- **The decision LLM is the brain.** Jev or Laya returns typed judgments: `choice` (one option), `noul` (probability of yes) and `score` (a position on ordered levels). Code then decides what the investor does.
- **The thinking LLM is the voice.** Ollama or Anthropic writes the investor's replies and the player's options, as text or as JSON that matches a schema.

Exactly one provider of each kind is active, chosen by config or env. Switching providers needs no code changes:

```bash
THINKING_PROVIDER=anthropic DECISION_PROVIDER=jev pnpm dev
```

Startup fails only on bad configuration, for example an unknown provider or a missing key for the _active_ provider. An unreachable provider never stops the server.

### Ollama (thinking, local)

```bash
ollama pull llama3.1:8b   # the model set in llm.thinking.providers.ollama.model
ollama serve              # http://localhost:11434 (override with OLLAMA_BASE_URL)
```

Sampling options (`temperature`, `maxTokens`) live in the Ollama config block. JSON requests send the schema in Ollama's `format` field.

### Anthropic (thinking, hosted)

Set `THINKING_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. The defaults are `claude-opus-5-5` with `effort: "low"`, since investor replies are short chat turns. Current Claude models reject `temperature`, so depth and cost are controlled with `effort`. `fallbacks: true` turns on Anthropic's server-side refusal fallback (`fallbacks: "default"`); if the whole chain still declines, the call fails with `PROVIDER_BAD_RESPONSE`.

### Laya (decision, self-hosted)

```bash
pip install "laya[serve]"
laya-serve                # http://localhost:8000 (override with LAYA_BASE_URL)
```

Laya speaks the same wire protocol as Jev, so both use the official `@typesafe-ai/sdk` client. `model` picks the checkpoint: `english` (the default), `multilingual` or `typed-decisions`. Without `LAYA_API_KEY` the server is unauthenticated. The client still sends a placeholder token, which laya-serve ignores.

### Jev (decision, hosted)

Set `DECISION_PROVIDER=jev` and `TYPESAFE_API_KEY`.

> **Confidence values are not comparable between Jev and Laya.** They compute confidence differently, so calibrate any threshold separately for each provider.

### Errors

Provider failures use the standard error format:

| Code                    | HTTP | Meaning                                                                                    |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `PROVIDER_UNAVAILABLE`  | 503  | Unreachable, timed out, rate-limited, overloaded, or credentials rejected (see server log) |
| `PROVIDER_BAD_RESPONSE` | 502  | Invalid JSON after one retry, a refusal, or an inconsistent answer                         |

### Health

`GET /api/health` reports `checks.thinking` and `checks.decision` as `ok` or `error`. These checks never change the HTTP status, which only the database decides, and the response never names a provider. Results are cached for `llm.healthCacheMs` (30 s by default).

### Dev playground

When `dev.playground` is `true` (the committed default) and `NODE_ENV` is not `production`, three endpoints let you try the active providers by hand. They need the session cookie, plus a CSRF token only when CSRF is enabled:

```bash
API=http://localhost:3001
# Only when CSRF is enabled; with it off, /api/csrf-token is 404 and TOKEN can stay empty.
TOKEN=$(curl -s -c jar -b jar $API/api/csrf-token | node -pe 'JSON.parse(require("fs").readFileSync(0)).csrfToken ?? ""')
post() { curl -s -c jar -b jar -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" -d "$2" "$API$1"; echo; }

post /api/dev/thinking/text '{"system":"You are a greedy investor.","messages":[{"role":"user","content":"500k for 15%?"}]}'

post /api/dev/thinking/json '{"messages":[{"role":"user","content":"Give me 3 reply options"}],
  "schema":{"type":"object","properties":{"options":{"type":"array","items":{"type":"string"}}},"required":["options"]}}'

post /api/dev/decision '{"state":{"player_offer":{"investment":500000,"equity":15}},
  "questions":{"reaction":{"type":"choice","instructions":"How should the investor react?",
  "criteria":{"accept":null,"counter":null,"reject":null,"walk_away":null}}}}'
```

Without Ollama or laya-serve running, start the API with `THINKING_PROVIDER=fake DECISION_PROVIDER=fake pnpm dev`. Fake providers are refused in production.

## Investor personas

`GET /api/personas` lists the six investors a player can pick: `greedy-shark`, `generous-angel`, `angry-rude`, `content-well-fed`, `skeptical-analyst` and `impact-investor`. Each persona has a public profile (`id`, `name`, `avatar`, `tagline`, `traits`), and that is all the endpoint returns.

The rest stays on the server, in `apps/api/src/personas/personaDefinitions.ts`:

- a **brain description** (`personality`, `goals`) for the decision model
- **voice instructions** (`toneInstructions`) for the thinking model
- **hidden numbers** (`budget`, `minEquity`, `maxEquity`, `initialInterest`, `patience`, `concessionStep`) that code negotiates with

Every definition is validated at startup; an invalid one stops the server with a message naming the persona and field.

```bash
curl -s localhost:3001/api/personas
```

Decision calls made for a game go through `DecisionLogger`, which records the questions, answers (or error code) and latency in the `decision_logs` table for the brain-insights panel.

## Testing the API with Postman

`postman/` holds a collection and a local environment:

1. In Postman, **Import** `postman/investor-api.postman_collection.json` and `postman/local.postman_environment.json`.
2. Select the **Investor local** environment. It sets `baseUrl` to `http://localhost:3001` and `allowedOrigin` to `http://localhost:5173`.
3. Start the API. Without Ollama or laya-serve, use `THINKING_PROVIDER=fake DECISION_PROVIDER=fake pnpm dev`.
4. Run **Session & CSRF** first, or run the whole collection in order with the Collection Runner. Postman keeps the player cookie. If the server has CSRF enabled, the token is saved to `{{csrfToken}}` and sent as `X-CSRF-Token`. If it's disabled (the default), _Get CSRF token_ answers 404, no token is sent, and the two CSRF checks are reported as skipped.

The collection's folders:

| Folder          | What it does                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| System          | Health check                                                                                              |
| Session & CSRF  | Session and CSRF token                                                                                    |
| Game            | List personas (public fields only)                                                                        |
| Playground      | Thinking text, thinking JSON, and the decision endpoint with the tutor's question set                     |
| Security checks | Missing or forged CSRF token, form body, malformed JSON, validation errors, 404, allowed and blocked CORS |

Every response is also checked for the security headers and, on errors, for the error envelope.

With fake providers, _Thinking: JSON_ fails with 502 by design, because the fake has no scripted JSON. Playground requests count against the mutation rate limit of 60 per 15 minutes. With CSRF enabled, run _Get CSRF token_ again after clearing cookies, because the token is bound to the player cookie.

To run the collection from the terminal with [Newman](https://www.npmjs.com/package/newman):

```bash
npx newman run postman/investor-api.postman_collection.json -e postman/local.postman_environment.json
```

## Security

| Concern         | What the API does                                                                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headers         | `helmet`, set up for an API: `default-src 'none'`, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, `X-Frame-Options: DENY`. HSTS is sent in production only, and `X-Powered-By` is removed                                                                                                       |
| CORS            | Exact-match allowlist from config, with credentials. Other origins get no CORS headers, and their preflights end before any session work                                                                                                                                                             |
| Identity        | Anonymous player ID in a signed, `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefix and `Secure` in production). A tampered or unknown cookie gets a new player                                                                                                                                     |
| CSRF            | **Off by default** (`security.csrf.enabled` / `CSRF_ENABLED`). When on: a signed double-submit token (`csrf-csrf`), HMAC-bound to the player ID, required on POST/PUT/PATCH/DELETE. When off, cross-site writes are still blocked by `SameSite=Lax` cookies, JSON-only bodies and the CORS allowlist |
| Input           | Only `application/json` bodies on POST/PUT/PATCH, a 100 KB body limit, and strict zod validation that rejects unknown fields                                                                                                                                                                         |
| Abuse           | Per-IP rate limits: a global limit, plus a stricter one for mutating requests. `X-Forwarded-For` is trusted only when `server.trustProxy` is configured                                                                                                                                              |
| Errors and logs | No stack traces or internal messages in production responses. Cookies, authorization and CSRF headers are redacted from logs                                                                                                                                                                         |

### Contract for the web client

```ts
// 1. Always send cookies.
const api = (path: string, init: RequestInit = {}) =>
  fetch(`${API_URL}${path}`, { credentials: 'include', ...init });

// 2. Only when CSRF is enabled on the server: fetch a token once (and again after a 403 CSRF_INVALID).
//    With CSRF disabled, /api/csrf-token is 404 and the header can be omitted.
const { csrfToken } = await (await api('/api/csrf-token')).json();

// 3. Send it with every mutating request.
await api('/api/games', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
  body: JSON.stringify({ personaId: 'greedy-shark' }),
});
```

Clearing cookies starts a new anonymous player. This is by design, since the game has no accounts.

## The `development` export condition

`@investor/shared` declares a custom `development` export that points to its TypeScript sources:

- `tsx` (`pnpm dev`) and Vitest run with that condition, so changes to `shared` take effect without a build.
- `pnpm build` and `pnpm start` resolve the compiled `dist/` instead.

If you add a new tool that imports `@investor/shared`, enable that condition in it too.
