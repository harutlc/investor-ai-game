## ADDED Requirements

### Requirement: Listing a player's games
The system SHALL list a player's games as summaries, newest first, built from the stored sessions without loading their transcripts. Other players' games MUST NOT be included.

#### Scenario: Newest first
- **WHEN** a player started game A and then game B
- **THEN** the list is B, A
