## MODIFIED Requirements

### Requirement: Dialogue for every action
The system SHALL write the investor's reply for every policy action: `counter` and `accept` state the action's offer; `reject` and `dismiss` hold the current offer (`dismiss` brushes off the manipulation attempt in character); `clarify` asks the player to clarify their position; `walk_away` ends the negotiation. The reply MUST be in the persona's tone and between 1 and 4000 characters.

When the player accepts the investor's current offer, the system SHALL write a closing line. It confirms the deal at that offer, the investor's own, and closes the negotiation. The closing line MUST NOT present the deal as the investor accepting an offer from the founder, and no player options are generated with it.

#### Scenario: Dismissing a manipulation attempt
- **WHEN** the action is `dismiss` with the current offer €500,000 for 30%
- **THEN** the reply does not accept anything, and any offer it states is €500,000 for 30%

#### Scenario: Player accepts the investor's offer
- **WHEN** the investor's current offer is €550,000 for 24% and the player accepts it
- **THEN** the closing line is written with an instruction to confirm the deal on the investor's own offer, not an instruction to accept the founder's offer, and no options are generated

### Requirement: Number consistency
Every generated investor line SHALL be checked by code before use:
- **Numbers in play**: the decided offer, the investor's previous offer, the player's current offer, the post-money and pre-money valuations of each, the differences between those offers' investments and between their equities, the pitch's valuation and ask amount, and numbers that appear in the pitch description or the player's latest message.
- Every amount in the line MUST match a number in play within 2% (or €1,000, whichever is larger). Every percentage MUST match a number in play exactly (to 2 decimals).
- For `counter`, `accept`, the opening and the closing line, the decided offer's investment and equity MUST both appear.

A line that fails is regenerated once, with the problems listed. If it fails again, or the provider fails, the system MUST use a code-written template line for the action that states the decided numbers.

#### Scenario: Invented number
- **WHEN** the decided counter is €550,000 for 24% and the model writes "I'll do €550k for 21%"
- **THEN** the line is rejected and regenerated

#### Scenario: Rounded valuation allowed
- **WHEN** the player offered €500,000 for 15% and the model writes "that values you at €3.3M"
- **THEN** €3.3M matches the €3,333,333 post-money valuation within 2% and the line is accepted

#### Scenario: Gap between offers
- **WHEN** the investor moved from €500,000 to €550,000 and a line or option says "the extra €50k"
- **THEN** €50k matches the difference between the offers and is accepted

#### Scenario: Fallback line
- **WHEN** both attempts for a `counter` of €550,000 for 24% fail the check
- **THEN** the investor says a template line stating €550k and 24%, and the result is flagged as a fallback

#### Scenario: Closing line fallback
- **WHEN** the player accepted €550,000 for 24% and the provider is unavailable
- **THEN** the investor says a template closing line stating €550k and 24%, and the result is flagged as a fallback
