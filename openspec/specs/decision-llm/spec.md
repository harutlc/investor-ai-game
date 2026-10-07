# decision-llm Specification

## Purpose

Gives the application typed, probabilistic judgments from a System One decision model (choice, noul, score) through one provider-neutral interface. The concrete backend (hosted Jev, self-hosted Laya, or a fake) is chosen by configuration.

## Requirements

### Requirement: Provider selection by configuration
The system SHALL use exactly one active decision provider, named by `llm.decision.provider` in the config file. Supported names are `jev`, `laya` and `fake`. The `DECISION_PROVIDER` environment variable MUST override the file value. Switching providers MUST NOT require code changes.

#### Scenario: Environment override
- **WHEN** the config file selects `laya` and `DECISION_PROVIDER=jev`
- **THEN** decision requests are served by the Jev provider

#### Scenario: Unknown provider
- **WHEN** the active decision provider is `gpt`
- **THEN** startup fails with a configuration error naming `llm.decision.provider`

### Requirement: Per-provider settings and secrets
Each decision provider SHALL have its own settings block under `llm.decision.providers.<name>`, with `baseUrl`, `model`, `timeoutMs` and `maxRetries`. `LAYA_BASE_URL` MUST override the Laya base URL. Keys SHALL come only from the environment. When the active provider is `jev` and `TYPESAFE_API_KEY` is missing, startup MUST fail naming that variable. `LAYA_API_KEY` is optional; when it is set, it MUST be sent as a bearer token to Laya. When the active provider is `fake` and `NODE_ENV=production`, startup MUST fail. Key values MUST NOT appear in error messages, logs or HTTP responses.

#### Scenario: Jev without key
- **WHEN** the active decision provider is `jev` and `TYPESAFE_API_KEY` is unset
- **THEN** startup fails with a message naming `TYPESAFE_API_KEY`

#### Scenario: Laya without key
- **WHEN** the active decision provider is `laya` and `LAYA_API_KEY` is unset
- **THEN** startup succeeds and requests to Laya are sent without a real key

### Requirement: Question types
The decision provider SHALL accept a state (text, JSON object or array) and a non-empty map of named questions:
- **choice**: instructions plus 2–100 labeled options with optional descriptions
- **noul**: instructions plus optional descriptions of the yes and no outcomes
- **score**: instructions plus 2–10 ordered level descriptions

A question set that breaks these limits MUST be rejected before any request is sent.

#### Scenario: Too many options
- **WHEN** a choice question has 150 options
- **THEN** the call fails before contacting the backend

### Requirement: Normalized answers
The decision provider SHALL return one answer per question name, in a provider-neutral shape:
- **choice**: the selected label, a confidence (0–1) and probabilities per label
- **noul**: the probability of yes (0–1)
- **score**: the expected score, a confidence (0–1) and probabilities per level

Each result MUST also report:
- the provider name;
- the model the backend reports;
- token usage: input tokens, and output tokens when the backend reports them, otherwise 0;
- latency in milliseconds.

Provider-specific response fields MUST NOT leak into these types.

#### Scenario: Mixed question set
- **WHEN** the caller asks a choice question `reaction`, a noul question `good_deal` and a score question `accept` over the same state
- **THEN** it receives `reaction` with a label from its criteria and probabilities, `good_deal` with a probability between 0 and 1, and `accept` with a score between 0 and 4

#### Scenario: Unknown label from backend
- **WHEN** the backend returns a choice label that is not among the question's criteria
- **THEN** the call fails with `PROVIDER_BAD_RESPONSE`

#### Scenario: Output tokens reported
- **WHEN** the backend reports 420 input and 12 output tokens
- **THEN** the result's usage shows 420 input tokens and 12 output tokens

### Requirement: Parallel requests
The decision provider SHALL run several independent requests concurrently and return their results in request order. If any request fails, the whole call MUST fail with that request's error.

#### Scenario: Three requests in parallel
- **WHEN** the caller submits three requests with different states and questions
- **THEN** the requests run concurrently and the results come back in the same order as the requests

### Requirement: Failure mapping
The following failures of the decision backend SHALL surface as `PROVIDER_UNAVAILABLE` (HTTP 503):
- connection failures and timeouts;
- rate limiting (429), overload (529) and other 5xx errors;
- authentication failures (401/403). These MUST also write a `warn` log entry that points at the API key without containing it.

Request validation errors reported by the backend (422) and malformed responses SHALL surface as `PROVIDER_BAD_RESPONSE` (HTTP 502).

Configured timeouts and retry limits MUST be enforced. Every final failure MUST be logged once as `llm.call_failed` at `error` (see llm-call-logging), and the provider MUST NOT log the same failure again.

#### Scenario: Laya not running
- **WHEN** laya-serve is not reachable and a decision request is made
- **THEN** the call fails with `PROVIDER_UNAVAILABLE`, and exactly one `error` line describes the failure

### Requirement: Reachability check
The decision provider SHALL expose a reachability check that confirms the backend answers (and, for Jev, that the key is accepted), without running a judgment. The check MUST time out within 3 seconds.

#### Scenario: Jev key rejected
- **WHEN** the TypeSafe API answers the reachability check with 401
- **THEN** the check reports an error

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
