## ADDED Requirements

### Requirement: Confidence threshold
The system SHALL read a confidence threshold from `llm.decision.minConfidence` (a number from 0 to 1; 0.55 in the committed config) and SHALL mark each decision answer as certain or uncertain against it:
- **choice** and **score** answers are uncertain when their confidence is below the threshold.
- **noul** answers are uncertain when the probability of the more likely outcome (the larger of the yes and no probabilities) is below the threshold.

Marking answers MUST NOT change their values. An invalid threshold MUST stop startup with a message naming `llm.decision.minConfidence`.

#### Scenario: Low-confidence choice
- **WHEN** the threshold is 0.55 and a choice answer has confidence 0.41
- **THEN** that answer is marked uncertain and keeps its selected label

#### Scenario: Confident noul
- **WHEN** the threshold is 0.55 and a noul answer has a yes probability of 0.2
- **THEN** that answer is certain, because the no outcome has probability 0.8

#### Scenario: Invalid threshold
- **WHEN** the config file sets `llm.decision.minConfidence` to `1.5`
- **THEN** startup fails with a message naming `llm.decision.minConfidence`

### Requirement: Decision calls are logged per game
Every decision call the game makes for a game session SHALL write one decision log entry with the session, turn, stage, provider, model, questions, answers and latency.
- When the call fails, the entry MUST record the error code instead of answers, and the original error MUST still reach the caller.
- When writing the entry fails, the failure MUST be logged and MUST NOT change the decision result or error returned to the caller.
- Entries MUST NOT contain API keys or other secrets.

#### Scenario: Successful call logged
- **WHEN** the game asks two questions for session S, turn 3, stage `B`, and the provider answers
- **THEN** a decision log entry for S, turn 3, stage `B` holds both questions, both answers, the provider, the model and the latency

#### Scenario: Failed call logged
- **WHEN** the provider is unreachable during a decision call for session S
- **THEN** a decision log entry records `PROVIDER_UNAVAILABLE` with no answers, and the caller receives the `PROVIDER_UNAVAILABLE` error

#### Scenario: Log write failure
- **WHEN** the provider answers but the decision log entry cannot be written
- **THEN** the caller still receives the answers and the write failure is logged
