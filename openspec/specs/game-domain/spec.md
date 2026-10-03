# game-domain Specification

## Purpose

Defines the shared game vocabulary used by the API and the UI: money and equity values, offers, pitches, chat messages, player options, game status, public investor hints, request and response contracts, the valuation math behind every offer, and the validated game settings.

## Requirements

### Requirement: Money and equity values
The system SHALL represent money as a whole number of euros and equity as a percentage of the company.
- An investment amount MUST be an integer greater than 0.
- An equity percentage MUST be greater than 0 and less than 100, with at most 2 decimal places.
Values outside these rules MUST be rejected wherever they cross an API or storage boundary.

#### Scenario: Fractional euros rejected
- **WHEN** an offer has an investment of `500000.5`
- **THEN** validation fails on the investment field

#### Scenario: Equity out of range
- **WHEN** an offer has an equity of `0`, `100` or `12.345`
- **THEN** validation fails on the equity field

### Requirement: Valuation math
The system SHALL compute valuations from an investment and an equity percentage the same way in the API and the UI:
- **post-money valuation** = investment ÷ (equity ÷ 100), rounded to the nearest euro
- **pre-money valuation** = post-money valuation − investment
- **equity for an amount** at a given post-money valuation = amount ÷ post-money × 100, rounded to 2 decimal places
- **amount for an equity** at a given post-money valuation = post-money × equity ÷ 100, rounded to the nearest euro

Inputs that break the money and equity rules, or an amount at or above the post-money valuation, MUST be rejected with an error instead of returning a number.

#### Scenario: Tutor's opening offer
- **WHEN** the valuation of €500,000 for 30% is computed
- **THEN** the post-money valuation is €1,666,667 and the pre-money valuation is €1,166,667

#### Scenario: Round trip
- **WHEN** the equity for €500,000 at a post-money valuation of €2,500,000 is computed
- **THEN** the result is 20, and the amount for 20% at €2,500,000 is €500,000

#### Scenario: Invalid input
- **WHEN** the post-money valuation is computed for an equity of 0
- **THEN** an error is raised and no number is returned

### Requirement: Offer contract
An offer SHALL carry `investment`, `equity`, `impliedValuation`, `from` (`player` or `investor`) and `turn` (an integer ≥ 0). `impliedValuation` MUST equal the post-money valuation computed from `investment` and `equity`. An offer whose `impliedValuation` does not match MUST be rejected.

#### Scenario: Consistent offer
- **WHEN** an offer of €500,000 for 15% states an implied valuation of €3,333,333
- **THEN** the offer is accepted

#### Scenario: Inconsistent offer
- **WHEN** an offer of €500,000 for 15% states an implied valuation of €2,000,000
- **THEN** validation fails on `impliedValuation`

### Requirement: Pitch, chat and option contracts
The system SHALL define:
- **Startup pitch**: `name` (1–80 characters), `sector` (1–60), `description` (1–2000), `valuation` (the founder's asked pre-money valuation, a money value) and `askAmount` (a money value).
- **Chat message**: `id`, `role` (`player`, `investor`, `system` or `event`), `text` (1–4000 characters) and an ISO-8601 `createdAt`.
- **Player option**: `id`, `kind` (`counter`, `accept`, `decline`, `message`, `answer` or `leverage`), `label` (1–120 characters) and an optional `offer`. An option of kind `counter` MUST carry an offer.

Values outside these limits MUST be rejected.

#### Scenario: Counter option without an offer
- **WHEN** a player option has kind `counter` and no offer
- **THEN** validation fails

#### Scenario: Unknown message role
- **WHEN** a chat message has role `narrator`
- **THEN** validation fails on `role`

### Requirement: Game status and phase
A game SHALL have a status of `negotiating`, `deal`, `walked_away`, `rejected_by_player` or `out_of_turns`, and a phase of `pitch`, `due_diligence`, `term_negotiation`, `closing` or `finished`. Any other value MUST be rejected.

#### Scenario: Unknown status
- **WHEN** a game session has status `paused`
- **THEN** validation fails on `status`

### Requirement: Public contracts never carry hidden investor numbers
Every contract the API returns to players SHALL contain only public information about the investor. The investor's budget, equity limits, exact interest, exact patience, concession step, brain description and voice instructions MUST NOT be part of any public contract. Investor state MUST reach the player only as hints: an interest level (`low`, `medium` or `high`), a patience hint and an optional trust hint, each a short text. Public contracts MUST reject unknown fields, so hidden numbers cannot slip through.

#### Scenario: Hidden field rejected
- **WHEN** a public game session or persona payload contains a `budget` field
- **THEN** validation fails

### Requirement: Game request contracts
- **Create game request**: a `personaId` and a startup `pitch`.
- **Play turn request**: exactly one of `optionId` (a generated option's id), `offer` (a structured offer with `investment` and `equity`) or `message` (free text, 1–1000 characters).

A request with none, or more than one, of the turn inputs MUST be rejected.

#### Scenario: Two turn inputs
- **WHEN** a play-turn request contains both `optionId` and `message`
- **THEN** validation fails

#### Scenario: Free-text turn
- **WHEN** a play-turn request contains only `message: "€500k for 15%"`
- **THEN** validation succeeds

### Requirement: Game settings
The system SHALL read game settings from a `game` section of the config file:
- `currency`: `EUR` (the only supported value)
- `maxTurns`: an integer from 1 to 50 (15 in the committed config)
- `defaultValuation`: a money value (€2,000,000 in the committed config)
- `features`: booleans for `phases`, `dueDiligence`, `dealTerms`, `hiddenFacts`, `marketEvents` and `debrief`, plus `eventChance` (0–1)
- `policy`: the negotiation policy's thresholds and weights:
  - `acceptMinLevel`: a score level from 0 to 4 (3, "Probably accept", in the committed config)
  - `goodDealMin`, `walkAwayMinConfidence`, `injectionThreshold`, `insultThreshold`: numbers from 0 to 1 (0.5, 0.7, 0.6 and 0.6 in the committed config)
  - `concessionSteps`: non-negative numbers for `none`, `small`, `medium` and `large`, never decreasing in that order (0, 1, 2 and 3 in the committed config)
  - `patienceCost`: non-negative integers for `reject`, `insult` and `injection` (1, 2 and 1 in the committed config)
  - `interestWeight`: a number from 0 to 1 (0.2 in the committed config)

The v2 feature flags MUST be off in the committed config until their features exist. An invalid or missing setting MUST stop startup with a message naming the key.

#### Scenario: Invalid turn limit
- **WHEN** the config file sets `game.maxTurns` to `0`
- **THEN** startup fails with a message naming `game.maxTurns`

#### Scenario: Committed defaults
- **WHEN** the API starts with the committed config file
- **THEN** `game.maxTurns` is 15, `game.defaultValuation` is 2,000,000 and every v2 feature flag is off

#### Scenario: Decreasing concession steps
- **WHEN** the config file sets `game.policy.concessionSteps` to `{ none: 0, small: 2, medium: 1, large: 3 }`
- **THEN** startup fails with a message naming `game.policy.concessionSteps`

#### Scenario: Invalid policy threshold
- **WHEN** the config file sets `game.policy.injectionThreshold` to `1.5`
- **THEN** startup fails with a message naming `game.policy.injectionThreshold`

### Requirement: Money formatting
The system SHALL format euro amounts the same way in the API and the UI:
- **Compact**: below €1,000 as whole euros (`€950`); below €1,000,000 in thousands with at most 1 decimal (`€500k`, `€12.5k`); otherwise in millions with at most 2 decimals (`€1.2M`, `€1.67M`, `€2M`). Trailing zeros MUST be dropped, and an amount that rounds up to the next unit MUST use that unit (€999,999 is `€1M`, not `€1000k`).
- **Full**: whole euros with comma thousands separators (`€500,000`).

Amounts that break the money rules MUST be rejected with an error instead of returning text.

#### Scenario: Compact amounts
- **WHEN** €500,000, €1,666,667 and €2,000,000 are formatted compactly
- **THEN** the results are `€500k`, `€1.67M` and `€2M`

#### Scenario: Unit rollover
- **WHEN** €999,999 is formatted compactly
- **THEN** the result is `€1M`

#### Scenario: Full amount
- **WHEN** €1,500,000 is formatted in full
- **THEN** the result is `€1,500,000`

### Requirement: Game list contract
The system SHALL define a game summary with `id`, the persona's public profile, the startup's `name`, `status`, `turn`, `maxTurns`, the investor's current offer (or null), and ISO-8601 `createdAt` and `updatedAt`, and a game list `{ games: GameSummary[] }`. Both MUST reject unknown fields, so hidden investor numbers cannot be added to them.

#### Scenario: Hidden field rejected
- **WHEN** a game summary contains a `budget` field
- **THEN** validation fails
