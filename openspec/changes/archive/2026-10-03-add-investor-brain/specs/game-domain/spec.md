## ADDED Requirements

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
