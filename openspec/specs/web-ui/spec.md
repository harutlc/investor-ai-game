# web-ui Specification

## Purpose

The player-facing web app for the investor negotiation game. The player picks an investor, pitches a startup, negotiates turn by turn, and reads the outcome. The app follows the approved UI mock, shows the decision model's answers on demand, and never shows the investor's hidden numbers.

## Requirements

### Requirement: App shell and routes
The app SHALL have three routes:
- `/` (setup)
- `/games/:id` (negotiation)
- `/games/:id/debrief` (debrief)

Any other path MUST show a "Page not found" view with a link to `/`.

A header SHALL appear on every route. It shows the app name, a three-step indicator (Setup, Negotiation, Debrief) that highlights the current step, a "New game" link to `/`, and the theme toggle.

#### Scenario: Step indicator
- **WHEN** the player is on `/games/:id`
- **THEN** the "Negotiation" step is highlighted and "Setup" is shown as done

#### Scenario: Unknown path
- **WHEN** the player opens `/nowhere`
- **THEN** a "Page not found" view with a link to the setup screen is shown

### Requirement: Persona picker
The setup screen SHALL list every persona from `GET /api/personas` as a selectable card. Each card shows:
- an initials tile in a colour fixed per persona id
- the name and the persona id
- the tagline
- one badge per trait

Exactly one persona is selected at a time, and the first one is selected by default. The selection MUST be exposed to assistive technology (`aria-pressed`). While the personas load, skeleton cards are shown. If loading fails, an error with a "Try again" action is shown.

#### Scenario: Pick an investor
- **WHEN** the player clicks the "Grace Okafor" card
- **THEN** that card becomes the only selected one and the start button reads "Start negotiation with Grace Okafor"

#### Scenario: Personas unavailable
- **WHEN** `GET /api/personas` fails
- **THEN** the picker shows an error message and a "Try again" button that refetches

### Requirement: Pitch form
The setup screen SHALL have a pitch form with five fields:
- startup name
- sector
- description
- valuation (pre-money, €)
- ask amount (€)

The fields are prefilled with GreenCharge, EV charging, a one-line description, 2,000,000 and 500,000.

Under the valuation, the form SHALL show the compact amount ("€2M before the investment"). Under the ask, it SHALL show the equity the ask buys at that valuation (ask ÷ (valuation + ask), rounded to 2 decimals, for example "€500k for 20% at your valuation").

Fields MUST be validated with the same rules as the API's pitch schema:
- non-empty trimmed text within the length limits
- valuation and ask are positive whole euros

An invalid field shows its message next to it and disables the start button. A 400 from `POST /api/games` MUST show its validation details next to the matching fields.

#### Scenario: Valuation hint
- **WHEN** the valuation is 2,000,000 and the ask is 500,000
- **THEN** the hints read "€2M before the investment" and "€500k for 20% at your valuation"

#### Scenario: Invalid ask
- **WHEN** the ask amount is cleared or set to 0
- **THEN** the ask field shows an error and the start button is disabled

### Requirement: Starting a game
The start button SHALL post the selected persona and the pitch to `POST /api/games`. While the request runs, the button MUST be disabled and show a busy label. On success, the app MUST navigate to `/games/:id` of the new game. On failure, the app MUST show an error toast and keep the form as entered.

#### Scenario: Start
- **WHEN** the player clicks "Start negotiation with Rex Calloway" with a valid pitch
- **THEN** a game is created and the negotiation screen opens with the investor's opening message and offer

#### Scenario: Provider outage on start
- **WHEN** the API answers 503 `PROVIDER_UNAVAILABLE`
- **THEN** an error toast explains that the investor is unavailable, and the setup form keeps its values

### Requirement: Resume earlier games
The setup screen SHALL show a "Your games" list from `GET /api/games` when the player has at least one game. Each entry shows:
- the persona's tile and name
- the startup name
- a status label
- the turn counter ("turn 3 / 15")
- the investor's current offer, if any

An entry links to `/games/:id`. The list MUST be hidden when the player has no games.

#### Scenario: Resume a game
- **WHEN** a player who started a game returns to `/` and clicks it in "Your games"
- **THEN** the negotiation screen opens with that game's transcript

#### Scenario: First visit
- **WHEN** a new player opens `/`
- **THEN** no "Your games" section is shown

### Requirement: Conversation transcript
The negotiation screen SHALL show the game's messages in order:
- **investor messages:** left-aligned, with the persona's tile
- **player messages:** right-aligned, in a dark bubble
- **system messages:** centred, muted text

The transcript MUST be a polite live region (`role="log"`). It MUST scroll to the newest message when messages are added. A header above it shows the persona's tile, name and tagline, plus a status pill.

#### Scenario: Opening
- **WHEN** a new game opens
- **THEN** the transcript shows the system message and the investor's opening line, and the pill reads "Negotiating"

### Requirement: Turn in progress
While a turn request runs, the app SHALL:
- show the player's move immediately as a pending player bubble (an option's label, a formatted offer, or the typed message)
- show a typing indicator with the persona's first name ("Rex is typing…")
- disable every move input: options, the offer form, the message composer and the tabs' send buttons

Only one turn request MAY run at a time. On success, the pending bubble MUST be replaced by the session's real messages. On failure, the pending bubble MUST be removed, an error toast shown, and a typed message draft kept.

#### Scenario: Waiting for the investor
- **WHEN** the player sends "€500k for 15%" from the offer form
- **THEN** a pending bubble "€500k for 15%" and "Rex is typing…" appear, and all move inputs are disabled until the response arrives

#### Scenario: Turn fails
- **WHEN** the turn request fails with 409 `TURN_IN_PROGRESS`
- **THEN** the pending bubble disappears, a toast explains the problem, and the inputs are enabled again

### Requirement: Three ways to reply
While the game is `negotiating`, the move area SHALL offer three tabs: "Options", "Make an offer" and "Write a message". "Options" is selected by default.

**Options** lists the session's options as buttons, each with an uppercase kind label (Counter, Accept, Decline, Ask, Answer or Leverage) and its label:
- Accept options are styled positive; Decline options are styled destructive.
- Clicking an option sends its `optionId`.

**Make an offer** has:
- an investment amount input (whole euros)
- an equity slider from 1% to 60% in 0.5-point steps, showing the value
- a live preview of the implied post-money and pre-money valuation, and the pre-money's difference from the asked valuation ("+10% vs your asked €2M", or "Exactly your asked valuation")

The form starts from the player's last offer if there is one. Otherwise it starts from the ask amount and the equity the ask buys at the asked valuation, rounded to the nearest 0.5 point. "Send offer" posts `{ offer: { investment, equity } }` and MUST be disabled while the amount is not a positive whole number.

**Write a message** has a labelled text area (1–1000 characters after trimming) and a send button with an accessible name. Enter sends, and Shift+Enter inserts a new line.

#### Scenario: Preview
- **WHEN** the offer form holds €500,000 and 20%
- **THEN** the preview reads "€2.5M post · €2M pre" and "Exactly your asked valuation"

#### Scenario: Pick an option
- **WHEN** the player clicks the Accept option
- **THEN** the turn is sent with that option's id

#### Scenario: Empty message
- **WHEN** the message text area holds only spaces
- **THEN** the send button is disabled

### Requirement: Deal panel
The negotiation screen SHALL show a deal panel with:
- the turn counter ("Turn 2 / 15") and a progress bar of turns used
- the investor's current offer ("€500k for 30%", "€1.67M post · €1.17M pre")
- the player's last offer, or "—" and "No offer yet"
- the gap in equity points and in amount when both offers exist, or "Make an offer to see the gap."
- the player's original ask ("You asked €500k at €2M pre-money.")

#### Scenario: After a counter
- **WHEN** the investor offers €500k for 26% and the player last offered €500k for 20%
- **THEN** the panel reads "Gap: 6 equity points, €0 in amount"

### Requirement: Investor meters show hints only
The negotiation screen SHALL show "How {first name} seems" with:
- **Interest:** the interest level as a word (Low, Medium, High) and a three-segment bar filled 1, 2 or 3
- **Patience:** the patience hint text
- **Trust:** the trust hint, only when the session has one
- the note "Hints only. The real numbers stay hidden."

The meters MUST NOT show any number derived from the investor's hidden state.

#### Scenario: Medium interest
- **WHEN** the session's meters are `{ interestLevel: "medium", patienceHint: "Tapping the table" }`
- **THEN** two of three segments are filled, "Medium" and "Tapping the table" are shown, and no trust row appears

### Requirement: Brain insights sheet
The negotiation screen SHALL have a "Brain insights" button showing a summary:
- "No decision calls yet"
- otherwise "N decision calls · latest turn T"

The button opens a side sheet (a modal dialog that closes on Escape and with a close button). The sheet lists the entries of `GET /api/games/:id/insights`, newest first. Each entry shows its stage ("Stage A" or "Stage B"), its turn, its provider and model, and its latency in ms. Each entry lists every answer with:
- the question name and type
- a readable value:
  - a choice's chosen label
  - a score's level label and value ("Probably reject · 1.1")
  - a noul's probability ("p = 0.31")
- a confidence percentage and bar, where a noul's confidence is max(p, 1 − p)
- an "uncertain" badge when the confidence is below 0.55

A failed entry shows its error code instead of answers. With no entries, the sheet says that the opening offer is computed by code and no decision calls were made yet.

#### Scenario: After one turn
- **WHEN** the player played one counter-offer turn and opens the sheet
- **THEN** the sheet shows the turn's Stage B entries with each answer's value and confidence

#### Scenario: Close
- **WHEN** the sheet is open and the player presses Escape
- **THEN** the sheet closes and focus returns to the "Brain insights" button

### Requirement: End of the game
When the session's status is not `negotiating`:
- the move area SHALL be replaced by an end banner ("The deal is done." or "The negotiation is over.") and a "See the debrief" button that opens `/games/:id/debrief`
- the status pill MUST read "Deal", "Investor walked away", "You walked away" or "Out of turns"

#### Scenario: Accepting the deal
- **WHEN** the player accepts the investor's offer
- **THEN** the pill reads "Deal", no move inputs remain, and "See the debrief" is shown

### Requirement: Debrief
`/games/:id/debrief` SHALL show the finished game's outcome:
- **a deal:** "Deal closed", the final terms as the headline ("€550k for 22%"), and a terms list (investment, equity, post-money, pre-money in full euros), taken from the session's current investor offer
- **otherwise:** "No deal", a headline naming who ended it ("Rex walked away", "You walked away" or "Out of turns"), and the last investor offer

It also shows the turns used ("4 of 15 turns used") and a "Play again" button that opens `/`. Opening the debrief of a game that is still `negotiating` MUST redirect to `/games/:id`.

#### Scenario: Deal debrief
- **WHEN** a game ended in a deal at €550k for 22% and the player opens the debrief
- **THEN** it shows "Deal closed", "€550k for 22%", investment €550,000, equity 22%, post-money €2,500,000 and pre-money €1,950,000

#### Scenario: Too early
- **WHEN** the player opens the debrief of a game that is still negotiating
- **THEN** the app redirects to the negotiation screen

### Requirement: Missing games and failures
A game route whose id is unknown, owned by another player or not a UUID (404 or 400 from the API) SHALL show "Game not found" with a link to `/`. Any other load failure MUST show an error message with a "Try again" action. While a game loads, skeletons MUST be shown in place of the transcript and the side panels.

#### Scenario: Someone else's game
- **WHEN** a player opens another player's game URL
- **THEN** "Game not found" is shown

### Requirement: No hidden numbers in the UI
The app SHALL display only data received from the API's public responses. It MUST NOT contain, derive or display any investor's budget, equity limits, patience, interest number or personality text. In particular, no screen shows a reveal of the investor's hidden numbers (that is a later debrief feature).

#### Scenario: Debrief has no reveal
- **WHEN** a game ends and the debrief opens
- **THEN** no budget, equity range or patience value of the investor is shown

### Requirement: Responsive layout
On viewports 1024px wide and wider, the negotiation screen SHALL place the conversation and move area in a wide left column, and the deal panel, meters and insights button in a right column. Narrower viewports MUST stack them in that order. No screen MAY scroll horizontally at a 360px viewport width.

#### Scenario: Phone width
- **WHEN** the negotiation screen is shown at 390px wide
- **THEN** the conversation comes first, the panels follow below it, and there is no horizontal scroll

### Requirement: Light and dark theme
The header SHALL have a theme toggle that switches between light and dark colours. The first visit MUST follow the system preference. The choice MUST be remembered in the browser and applied before first paint on later visits. Text in both themes MUST meet WCAG AA contrast (4.5:1 for body text).

#### Scenario: Remembered choice
- **WHEN** the player switches to dark and reloads
- **THEN** the app opens in dark without a light flash

### Requirement: Accessible controls
Every interactive element SHALL be a native button, link or labelled form control, reachable and operable by keyboard with a visible focus ring. Icon-only buttons MUST have an accessible name, and touch targets MUST be at least 40px tall.

#### Scenario: Keyboard-only turn
- **WHEN** a player uses only Tab, arrow keys, Space and Enter
- **THEN** they can pick a persona, start a game, switch reply tabs, choose an option and send an offer
