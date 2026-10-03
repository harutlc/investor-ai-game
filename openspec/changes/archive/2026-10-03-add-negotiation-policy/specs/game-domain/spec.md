## MODIFIED Requirements

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
