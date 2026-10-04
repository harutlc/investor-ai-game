## 1. Scaffold `apps/web`

- [x] 1.1 Create `apps/web` (`@investor/web`): Vite, React 19 and TS.
  - `package.json` scripts: `dev`, `build`, `preview`, `typecheck` and `test`.
  - `tsconfig.json` per design §3.
  - `vite.config.ts` with the `/api` proxy and the `development` condition (design §1–2).
  - `index.html` with the pre-paint theme script.
  - Depend on `@investor/shared` with `workspace:*`.

  Verify `pnpm install` succeeds, and `pnpm --filter @investor/web typecheck` and `build` pass on a placeholder `App`.
- [x] 1.2 Add Tailwind v4 (`@tailwindcss/vite`) and run `shadcn init`. Then:
  - Add the components from design §9.
  - Map the mock's palette onto the light and dark tokens in `src/index.css`.
  - Add the `@fontsource` fonts (Bricolage Grotesque, IBM Plex Sans, IBM Plex Mono).

  Fix any generated code that fails strict TS. Verify typecheck and build pass, and a placeholder page shows the mock's background, ink and accent.
- [x] 1.3 Add Vitest with jsdom, Testing Library and jest-dom matchers (`vitest.config.ts`, a setup file), plus one smoke test. Verify `pnpm --filter @investor/web test` passes and the root `pnpm test` runs it.
- [x] 1.4 Root wiring:
  - `dev:web` and `build:web` scripts.
  - A web block in `eslint.config.js` (design §13).
  - `VITE_API_URL=` in `.env.example`.

  Verify `pnpm lint`, `pnpm typecheck` and `pnpm format:check` pass for the whole repo.

## 2. API client and data hooks

- [x] 2.1 Implement `ApiClientError`, `CsrfTokenStore` and `GameApiClient` (design §4). The client's methods are `listPersonas`, `listGames`, `getGame`, `startGame`, `playTurn` and `getInsights`. Verify unit tests with a fake `fetch`:
  - a valid body parses
  - a body with `budget` → `BAD_RESPONSE`
  - an error envelope → status and code
  - a non-envelope body → `UNKNOWN`
  - a fetch rejection → `NETWORK_ERROR`
  - the base URL prefix from the env
  - credentials included
  - CSRF 404 → no header and no second token request
  - a 403 `CSRF_INVALID` → one refresh and a single retry, with a second 403 surfaced
  - GETs never request a token
- [x] 2.2 Implement the query client defaults and the hooks `usePersonas`, `useGames`, `useGame`, `useInsights`, `useStartGame` and `usePlayTurn` (design §5). Verify hook tests with a `QueryClientProvider` and a fake client:
  - a start seeds `['game', id]`
  - a successful turn replaces the cached session and invalidates the insights and the game list
  - a failed turn leaves the cache untouched

## 3. Helper classes

- [x] 3.1 `OfferFormatter` and `ValuationPreview` (design §8). Verify tests:
  - €500k for 30% → "€500k for 30%" and "€1.67M post · €1.17M pre"
  - €500k / 20% vs a €2M ask → "€2.5M post · €2M pre" and "Exactly your asked valuation"
  - a +10% case
  - an invalid amount → no preview
  - the ask hint "€500k for 20% at your valuation"
  - the default equity rounded to 0.5
  - gap "6 equity points, €0 in amount"
- [x] 3.2 `PersonaAppearance`, `StatusText` and `DecisionAnswerFormatter`. Verify tests:
  - "Dr. Mira Chen" → "MC" / "Mira", and a stable colour per id
  - every `GameStatus` → pill label and debrief headline
  - choice, score (with a criteria label) and noul answers → display text, confidence, and the uncertain flag below 0.55
- [x] 3.3 `ThemeController`. Verify tests:
  - it follows the system preference when nothing is stored
  - it persists a toggle
  - it survives a throwing `localStorage`

## 4. Shell and setup screen

- [x] 4.1 App shell: router with the layout, the header (brand, step indicator, "New game" link, theme toggle), the `Toaster`, the "Page not found" route, and the `QueryClientProvider`. Verify a test that `/nowhere` renders "Page not found", and that the step indicator highlights by route.
- [x] 4.2 `PersonaPicker` with skeletons and an error-retry state, using `PersonaAppearance` tiles and `aria-pressed`. Verify a component test: the first persona is selected by default; a click selects only that card; the error state's "Try again" calls refetch.
- [x] 4.3 `PitchForm` with GreenCharge defaults, hints and validation from `StartupPitchSchema`. Map 400 details (`body.pitch.<field>`) onto the fields. Verify a component test: hints for €2M / €500k; clearing the ask disables start and shows an error.
- [x] 4.4 `SetupPage` (with `GameList`, hidden when empty) and the start flow: a busy button, navigation to `/games/:id`, and an error toast. Verify a page test with a fake client: start posts the selected persona and pitch, then navigates; a 503 shows a toast and keeps the values.

## 5. Negotiation screen

- [x] 5.1 `ChatPanel`: role layouts, the pending bubble, a typing indicator with the first name, `role="log"`, and auto-scroll. Verify a component test: investor, player and system messages render in order; a pending move shows the bubble and "Rex is typing…".
- [x] 5.2 `PlayerOptions`, `CustomOfferForm` and `MessageComposer` inside `ReplyTabs`, following the spec "Three ways to reply". Verify the component tests (design §12):
  - `PlayerOptions`: kind labels, click → id, disabled while busy
  - `CustomOfferForm`: initial values from the last offer or the ask; the preview text; send disabled for an invalid amount; payload `{ investment, equity }`
  - `MessageComposer`: whitespace disables send; Enter sends; Shift+Enter adds a new line
- [x] 5.3 `DealPanel`, `InvestorMeters` and `StatusPill`. Verify tests:
  - the turn counter and the gap text
  - medium interest fills 2 of 3 segments
  - no trust row without a hint
  - `InvestorMeters` renders no digits
- [x] 5.4 `BrainInsightsSheet` and its summary button, as a shadcn Sheet with Escape and focus return, empty state, error entries and answer rows. Verify a component test with a sample insights DTO: newest first, values, confidences and the uncertain badge; the empty state text.
- [x] 5.5 `NegotiationPage`:
  - the two-column / stacked layout and loading skeletons
  - "Game not found" for 404 or 400
  - the turn flow through `usePlayTurn`, with the pending bubble from `variables`, inputs disabled, a toast and the draft kept on error
  - the end banner with "See the debrief"

  Verify a page test with a fake client: a counter turn shows a pending state and then the new session; a 409 shows a toast and re-enables the inputs; a finished game shows no inputs.

## 6. Debrief screen

- [x] 6.1 `DebriefPage`: the outcome header, final terms for a deal (full euros, post- and pre-money), the last investor offer otherwise, the turns used and "Play again". A `negotiating` game redirects to `/games/:id`. Verify a page test:
  - a deal at €550k / 22% shows €550,000, 22%, €2,500,000 and €1,950,000
  - a walk-away shows "No deal"
  - a negotiating game redirects
  - no budget or equity-range text appears

## 7. Docs and end-to-end check

- [x] 7.1 README: a "Web UI" section covering:
  - how to run it (`pnpm dev` + `pnpm dev:web`, `http://localhost:5173`)
  - the proxy vs `VITE_API_URL`
  - the screens and the brain-insights sheet
  - the scripts and layout table rows for `apps/web`

  Verify the README lists both run commands and the env variable.
- [x] 7.2 Manual run against `pnpm dev` with the fake providers (`THINKING_PROVIDER=fake DECISION_PROVIDER=fake`) and `pnpm dev:web`, played in the browser:
  - pick a persona, start, play an option, an offer and a message
  - open the insights
  - accept or walk away, then read the debrief
  - resume from "Your games"
  - toggle dark mode
  - check 390px and 1280px widths

  Verify there are no console errors and no horizontal scroll at 390px. Then stop both servers and delete the scratch database.
- [x] 7.3 Final gates: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check` all pass, and `pnpm build:web` succeeds.
