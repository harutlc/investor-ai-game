## Context

- **The API is done for the MVP.** It serves `GET /api/personas` and `/api/games` (list, start, read, play a turn, insights). Every game response is parsed by strict zod schemas in `@investor/shared`, so hidden numbers cannot reach the client by construction.
- **The player is anonymous.** Identity is a signed `HttpOnly` cookie. CSRF is off by default; when it is on, mutations need an `X-CSRF-Token`, and `/api/csrf-token` is 404 while it is off. CORS already allows `http://localhost:5173` with credentials.
- **Dev serving.** The API serves on `:3001`. `@investor/shared` exposes its TypeScript sources through a custom `development` export condition; tsx and Vitest use it.
- **Look and behaviour come from the approved mock.**
  - Its JS state machine is the behavioural reference: tabs, a pending bubble with a typing indicator, a deal panel with a gap, meters, and an insights sheet.
  - Palette: ink `#15181E`, ground `#EDEFF2`, accent `#0E6B4F`.
  - Type: Bricolage Grotesque for display, IBM Plex Sans for body, IBM Plex Mono for numbers.
- **Repo conventions** (TASKS.md §0):
  - Strict TS with `exactOptionalPropertyTypes`, and no `any`.
  - One class per file.
  - Non-UI logic in the web app is written as classes; components are functions.
  - Every API boundary is validated with the shared schemas.
- **Data limits.** The DTOs give each chat message only `{ id, role, text, createdAt }`, with no offer and no turn. Insights entries carry the questions (including the choice and score criteria) and the raw answers.

## Goals / Non-Goals

**Goals:**

- The mock's screens, running against the real API with no API changes.
- A thin, testable split:
  - classes for formatting, valuation previews and the HTTP client
  - hooks for server state
  - presentational components that take plain props
- Development that works with one command per app and no build step for `shared`.

**Non-Goals:**

- Offer chips on individual chat messages. The DTO has no per-message offer, and the deal panel shows the offers. A later API change can add them.
- The "via" label (Option, Offer form or Free text) on player bubbles. It is not stored.
- Server-side rendering, PWA features, i18n, and E2E browser tests. Component and unit tests cover the logic.
- Production hosting of the web app by the API server.

## Decisions

### 1. Vite proxy for `/api` in development; `VITE_API_URL` optional

`vite.config.ts` proxies `/api` to `http://localhost:3001`, and `GameApiClient` uses `import.meta.env.VITE_API_URL ?? ''` as its prefix.

- Same-origin requests keep the `SameSite=Lax` cookie first-party with no CORS preflight.
- The same build still works cross-origin when `VITE_API_URL` is set, because the API's CORS allowlist plus `credentials: 'include'` already support it.
- *Rejected: always cross-origin.* Every POST would get a preflight, and the setup is harder to debug.

### 2. Resolve `@investor/shared` from source in Vite, Vitest and tsc

- **Vite and Vitest:** `resolve.conditions: ['development', ...defaultClientConditions]`.
- **tsconfig:** `moduleResolution: "bundler"` and `customConditions: ["development"]`.

`vite build` then bundles the shared TS directly, so the web app never depends on `shared/dist`. Shared imports use `.js` specifiers; Vite resolves them to `.ts`.

- *Rejected: building `shared` before the web app.* It adds a build-order dependency and a stale-dist class of bugs.

### 3. `apps/web` has its own tsconfig, not the API's base

The web app needs `lib: ["ES2023", "DOM", "DOM.Iterable"]`, `jsx: "react-jsx"`, `moduleResolution: "bundler"` and `types: ["vite/client"]`. It copies the base's strictness flags. Its `typecheck` script is `tsc --noEmit`, so the existing `pnpm -r typecheck` covers it.

- The root `tsc -b` references stay API and shared only.
- The web build is `vite build`, run through `pnpm -r build` and a root `build:web` script.

### 4. `GameApiClient` is one class with a private `request<T>(method, path, schema, body?)`

Each request:

1. Sends `credentials: 'include'`, plus `Content-Type: application/json` when there is a body.
2. On a 2xx, parses the JSON with the given zod schema. A failure throws `ApiClientError('BAD_RESPONSE')`.
3. On a non-2xx, parses `ApiErrorSchema`. Success throws `ApiClientError(status, code, message, requestId)`; otherwise it throws `UNKNOWN`.
4. A `fetch` rejection throws `NETWORK_ERROR`.

CSRF is handled by a small `CsrfTokenStore`:

- State is `unknown`, `disabled` or `token`.
- The first mutation loads the token; a 404 sets `disabled` for good.
- A 403 `CSRF_INVALID` triggers one refresh and a single retry.

`fetch` is injected through the constructor (default `globalThis.fetch`), so tests run without MSW.

- *Rejected: axios or ky.* `fetch` plus zod is enough, and adds no dependency.

### 5. TanStack Query

**Keys:**
- `['personas']`, with `staleTime: Infinity`
- `['games']`
- `['game', id]`
- `['insights', id]`, fetched together with the game: the insights button shows a summary ("2 decision calls · latest turn 2") before the sheet is opened

**Mutations:**
- `useStartGame` writes the returned session into `['game', id]` and invalidates `['games']`.
- `usePlayTurn(id)` writes `result.session` into `['game', id]` and invalidates `['games']` and `['insights', id]`.

**Retries and refetching:**
- Queries do not retry on 4xx and retry once otherwise.
- `refetchOnWindowFocus` is off for game views, so a stale tab never overwrites an in-flight turn's view.

**Pending turn:** `usePlayTurn` exposes `variables` while it is pending. The negotiation screen renders the pending bubble from `variables` and the current options or form state, so the cache is never touched optimistically. A failure therefore needs no rollback.

### 6. Pending bubble text is derived from the move

| Move | Bubble text |
| --- | --- |
| `optionId` | The option's label |
| `offer` | `OfferFormatter.short({ investment, equity })`, e.g. "€500k for 15%" |
| `message` | The trimmed text |

The server's player message replaces the bubble when the session returns. It may read differently from the label, for example the option's full phrasing.

### 7. Presentational components take DTOs and callbacks; containers own the hooks

**Containers:**
- `SetupPage`
- `NegotiationPage`
- `DebriefPage`

**Presentational components:**
- Setup: `PersonaPicker`, `PitchForm`, `GameList`
- Negotiation: `ChatPanel`, `ReplyTabs`, `PlayerOptions`, `CustomOfferForm`, `MessageComposer`, `DealPanel`, `InvestorMeters`
- Overlays: `BrainInsightsSheet`, `StatusPill`

The three components the spec singles out for tests (`CustomOfferForm`, `PlayerOptions`, `InvestorMeters`) are pure props-in, callbacks-out.

### 8. UI helper classes (one per file, `src/lib/`)

- **`OfferFormatter`**
  - `short(o)` → "€500k for 30%"
  - `valuation(o)` → "€1.67M post · €1.17M pre"
  - `gap(investor, player)`
  - Built on the shared `MoneyFormatter` and `ValuationCalculator`, so the numbers match the API's voice checks.
- **`ValuationPreview`**
  - Validates the form input.
  - Returns post, pre and the difference from the asked valuation.
  - Returns the "equity the ask buys" hint, and the default equity rounded to 0.5.
- **`PersonaAppearance`**
  - Initials from the name, ignoring honorifics ("Dr. Mira Chen" → "MC").
  - First name for "Rex is typing…".
  - Colour from a fixed palette, keyed by the six known ids (the mock's colours) with a hash fallback for unknown ids.
  - The API's emoji `avatar` is not shown: the approved mock uses initials tiles, and the design rules exclude emoji.
- **`DecisionAnswerFormatter`**
  - Turns an insights entry's answer plus its question into `{ name, type, display, confidence, uncertain }`.
  - Score labels come from `question.criteria[round(value)]` when that is a string; otherwise "level N".
  - The uncertain threshold is the constant 0.55, matching the default `llm.decision.minConfidence`. It affects display only.
- **`StatusText`**: maps each status to its pill label, colours, end-banner text and debrief headline.

### 9. Styling: Tailwind v4 with shadcn/ui, themed to the mock

- Run `shadcn init`, choosing the "new-york" style with CSS variables.
- Only the components actually used are added:
  - button, card, input, textarea, label, slider, badge, tabs, sheet, skeleton, sonner, tooltip, scroll-area
  - form, select, switch and the others from §15.1's list are left for v2, which needs them.
- `index.css` maps the mock's palette onto shadcn's tokens for light and dark:
  - light: `--background` #EDEFF2, `--foreground` #15181E, `--primary` #0E6B4F, plus muted, border and destructive
  - a hand-tuned dark set that meets AA contrast
- Fonts are self-hosted through `@fontsource` packages, so no third-party request is needed at runtime.
- *Rejected: copying the mock's inline styles.* Tokens are needed for dark mode, and Tailwind keeps the markup readable.

### 10. Theme toggle

- A `ThemeController` class reads and writes `localStorage['inv.theme']`, wrapping every access in try/catch, and toggles `.dark` on `<html>`.
- A tiny inline script in `index.html` applies the stored or system theme before React mounts, so there is no flash.
- *Rejected: the `next-themes` package.* It is overkill without Next.

### 11. Routing

- React Router in data-less mode (`createBrowserRouter`), with a layout route for the header.
- `NegotiationPage` and `DebriefPage` read `:id`:
  - API 404 or 400 renders `GameNotFound`.
  - A debrief of a `negotiating` game renders `<Navigate replace>` to the negotiation page.
  - A finished game's negotiation page shows the end banner.

### 12. Tests

- Vitest runs with `environment: 'jsdom'`, `@testing-library/react`, `user-event`, and `@testing-library/jest-dom` matchers.
- **Components:**
  - `CustomOfferForm`: preview text, disabled send, the submitted payload.
  - `PlayerOptions`: kind labels, click → id, disabled while busy.
  - `InvestorMeters`: segments, no trust row, no digits rendered.
- **Classes:**
  - `GameApiClient` with a fake `fetch`: validation failure, the error envelope, the CSRF 404 path, the 403 retry-once path, the network error.
  - `OfferFormatter`, `ValuationPreview`, `DecisionAnswerFormatter` and `PersonaAppearance`.

### 13. Lint

`eslint.config.js` gains a block for `apps/web/**/*.{ts,tsx}`:

- browser globals
- `eslint-plugin-react-hooks` recommended rules
- `react-refresh/only-export-components` as a warning

The shadcn-generated `components/ui/**` files stay linted, and are fixed where strict rules complain. The TypeScript project service picks up the web app's tsconfig automatically.

## Risks / Trade-offs

- **shadcn's generated code may trip `exactOptionalPropertyTypes` or the strict lint rules.** → Fix the generated files in place (they are owned code). Do not loosen the strict flags.
- **A Tailwind v4 or shadcn CLI version drift.** → Pin the versions installed at apply time in `package.json`, and record the shadcn `components.json`.
- **A slow model makes turns take seconds.** → The typing indicator and the disabled inputs cover the wait. The API's TurnLock already turns a double submit into a 409, and the UI also blocks a second send while one is pending.
- **The proxy hides CORS problems that a cross-origin deployment would hit.** → The README documents both modes. The CORS allowlist is already tested on the API side.
- **No offer chips in chat makes the transcript less scannable than the mock.** → The deal panel always shows both current offers. The chips are a follow-up that needs a `game-api` change.
- **The uncertain threshold is duplicated from the config (0.55).** → It affects display only, and is documented. A future insights DTO could include the threshold.

## Migration Plan

This change is additive: a new package, with no API or database change. To roll back, delete `apps/web` and the root script and lint additions.
