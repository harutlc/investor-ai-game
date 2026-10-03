## ADDED Requirements

### Requirement: Opening offer
At the start of a game the system SHALL compute the investor's first offer in code, anchoring high: the investment is the founder's ask amount, capped at the investor's budget, and the equity is the investor's maximum equity. The opening offer is the investor's current offer until the policy changes it.

#### Scenario: Tutor's opening
- **WHEN** GreenCharge asks for €500,000 and the investor has a €700,000 budget and a 30% maximum equity
- **THEN** the opening offer is €500,000 for 30%

#### Scenario: Ask above the budget
- **WHEN** the founder asks for €900,000 from an investor with a €600,000 budget and a 40% maximum equity
- **THEN** the opening offer is €600,000 for 40%
