## ADDED Requirements

### Requirement: Game list contract
The system SHALL define a game summary with `id`, the persona's public profile, the startup's `name`, `status`, `turn`, `maxTurns`, the investor's current offer (or null), and ISO-8601 `createdAt` and `updatedAt`, and a game list `{ games: GameSummary[] }`. Both MUST reject unknown fields, so hidden investor numbers cannot be added to them.

#### Scenario: Hidden field rejected
- **WHEN** a game summary contains a `budget` field
- **THEN** validation fails
