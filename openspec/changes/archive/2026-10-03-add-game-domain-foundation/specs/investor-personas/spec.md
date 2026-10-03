## Purpose

Provides the investors a player can negotiate with: a fixed catalog of personas that differ in personality, voice and hidden negotiation numbers, and a public endpoint that lets the player choose one without revealing what the investor is really willing to do.

## ADDED Requirements

### Requirement: Persona catalog
The system SHALL offer exactly six investor personas, with these stable ids, in this order:
1. `greedy-shark`: pushes for maximum equity and haggles long
2. `generous-angel`: gives more money for less equity, warm and forgiving
3. `angry-rude`: impatient and harsh, walks away fast when insulted
4. `content-well-fed`: relaxed, in no hurry, moderate terms
5. `skeptical-analyst`: data-driven, distrusts exaggeration
6. `impact-investor`: mission-driven, strict about ethics

#### Scenario: Catalog contents
- **WHEN** the persona catalog is loaded
- **THEN** it contains exactly the six ids above, in that order, with no duplicates

### Requirement: Persona definition
Each persona SHALL define:
- **Public profile**: `id`, `name`, `avatar` (a short emoji or symbol), `tagline` and 1–4 `traits` (short badge labels)
- **Brain description**, given to the decision model: a `personality` and a list of `goals`
- **Voice instructions**, given to the thinking model: how the investor talks
- **Hidden negotiation numbers**: `budget` (a money value), `minEquity` and `maxEquity` (equity percentages), `initialInterest` (0–1), `patience` (an integer ≥ 1) and `concessionStep` (equity percentage points > 0)

`minEquity` MUST NOT exceed `maxEquity`. A persona that breaks any of these rules MUST stop startup with a message naming the persona id and the invalid field.

#### Scenario: Invalid equity range
- **WHEN** a persona defines `minEquity` 35 and `maxEquity` 30
- **THEN** startup fails with a message naming that persona and `minEquity`

### Requirement: Personas differ in their numbers
The hidden numbers SHALL make the personas play differently with the same moves:
- `greedy-shark` has the highest `maxEquity` and the smallest `concessionStep` of all personas.
- `generous-angel` has the lowest `minEquity` and the largest `concessionStep`.
- `angry-rude` has the lowest `patience`.
- `content-well-fed` has the highest `patience`.

#### Scenario: Greedy versus generous
- **WHEN** the hidden numbers of `greedy-shark` and `generous-angel` are compared
- **THEN** the shark's `maxEquity` is higher and its `concessionStep` is smaller than the angel's

#### Scenario: Impatient investor
- **WHEN** the `patience` of every persona is compared
- **THEN** `angry-rude` has the lowest value and `content-well-fed` the highest

### Requirement: List personas endpoint
The system SHALL expose `GET /api/personas`, which returns `{ "personas": [...] }` with each persona's public profile (`id`, `name`, `avatar`, `tagline`, `traits`) in catalog order. The response MUST NOT contain any hidden negotiation number, brain description or voice instruction. The endpoint is subject to the same player session, CSRF and rate-limit rules as the other `/api` endpoints.

#### Scenario: Public fields only
- **WHEN** a client calls `GET /api/personas`
- **THEN** the response is 200 with six personas, each with exactly `id`, `name`, `avatar`, `tagline` and `traits`

#### Scenario: No hidden data leaks
- **WHEN** a client calls `GET /api/personas`
- **THEN** the response body contains none of the keys `budget`, `minEquity`, `maxEquity`, `initialInterest`, `patience`, `concessionStep`, `personality`, `goals` or `toneInstructions`, and none of the personas' budget values

#### Scenario: Player session created
- **WHEN** a client without a player cookie calls `GET /api/personas`
- **THEN** the response sets a player cookie, as for any other `/api` endpoint
