## Why

The game is playable over HTTP (`/api/personas`, `/api/games`), but only through Postman. §15 of TASKS.md calls for the web UI. Its design is already settled: the clickable mock the user approved ("Investor Game UI Mock", setup → negotiation → debrief, with a brain-insights sheet). This change builds that UI as a real app on top of the existing endpoints, MVP parts only.

## What Changes

- New workspace package `apps/web` (`@investor/web`): React 19, Vite, TypeScript strict, Tailwind CSS v4, shadcn/ui components, TanStack Query and React Router.
- `GameApiClient`, a typed fetch wrapper:
  - Sends cookies with every request and validates every response with the `@investor/shared` zod schemas.
  - Maps the API error envelope to a typed `ApiClientError`.
  - Handles the optional CSRF token: fetches it lazily, skips it when `/api/csrf-token` is 404, and refreshes it once after a 403 `CSRF_INVALID`.
  - Reads its base URL from `VITE_API_URL`. In development the default is the Vite `/api` proxy.
- TanStack Query hooks: `usePersonas`, `useGames`, `useGame(id)`, `useStartGame`, `usePlayTurn`, `useInsights(id)`.
- Screens, styled after the mock: its colours, its type (Bricolage Grotesque, IBM Plex Sans and IBM Plex Mono) and its layout.
  - **Setup (`/`):**
    - A persona picker, plus a pitch form with GreenCharge defaults and live valuation hints.
    - A "Start negotiation" button.
    - A "Your games" list for resuming earlier games.
  - **Negotiation (`/games/:id`):**
    - `ChatPanel`, with a pending player bubble and a typing indicator while a turn runs.
    - Reply tabs: `PlayerOptions`, `CustomOfferForm` (amount, an equity slider and a live post/pre-money preview) and `MessageComposer`.
    - `DealPanel`, showing the investor's offer, your last offer, the gap and the turn counter.
    - `InvestorMeters` (hints only) and a status pill.
    - `BrainInsightsSheet`, built from `/api/games/:id/insights`.
  - **Debrief (`/games/:id/debrief`):** the outcome, the final terms and "Play again".
- UI helper classes: `OfferFormatter`, `ValuationPreview`, `PersonaAppearance` (initials and colour per persona), `DecisionAnswerFormatter`, `StatusText` and `ThemeController`. Money formatting reuses the shared `MoneyFormatter`.
- Loading skeletons, error toasts, inputs disabled while a turn runs, a responsive layout (two columns on desktop, stacked on mobile) and a light/dark theme toggle.
- Component and unit tests (Vitest, Testing Library, jsdom):
  - Components: `CustomOfferForm`, `PlayerOptions` and `InvestorMeters`.
  - Classes: `GameApiClient` and the formatters.
- Root scripts, ESLint for the web app, a README section, and `.env.example` gains `VITE_API_URL`.
- **Not in scope (v2):** the mystery investor, scenarios, deal-term switches, market events, the phase stepper, grades, coaching, and the hidden-number reveal. The mock showed these with a "v2" badge; the app leaves them out instead of drawing placeholders. No API changes.

## Capabilities

### New Capabilities

- `web-api-client`: the browser's typed access to the API. It covers cookies, response validation, error mapping, CSRF token handling, the base URL and the query hooks.
- `web-ui`: the player-facing screens and their behaviour:
  - setup, negotiation, debrief and brain insights
  - hidden-number safety in the UI
  - turn-in-progress handling, responsiveness and theming

### Modified Capabilities

None. The UI consumes the existing `game-api`, `investor-personas` and `api-security` contracts unchanged.

## Impact

- **New code:** `apps/web/**`. Workspace config is unchanged: `pnpm-workspace.yaml` already globs `apps/*`.
- **New dependencies (web only):**
  - Runtime: react, react-dom, react-router, @tanstack/react-query, tailwindcss, @tailwindcss/vite, shadcn/ui's Radix primitives, class-variance-authority, clsx, tailwind-merge, lucide-react, sonner and @fontsource packages.
  - Dev: vite, @vitejs/plugin-react, vitest, jsdom, @testing-library/react, @testing-library/user-event and eslint-plugin-react-hooks.
- **Root:**
  - `package.json` gains `dev:web` and `build:web` scripts.
  - `eslint.config.js` gains a browser and React block for `apps/web`.
  - `README.md` gains a Web UI section.
  - `.env.example` gains `VITE_API_URL`.
- **API:** no change. The dev server's CORS allowlist already contains `http://localhost:5173`.
