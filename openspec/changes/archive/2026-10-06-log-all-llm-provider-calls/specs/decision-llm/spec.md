## MODIFIED Requirements

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
