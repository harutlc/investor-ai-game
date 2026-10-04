## MODIFIED Requirements

### Requirement: Thinking JSON endpoint
`POST /api/dev/thinking/json` SHALL accept the same fields plus `schema`, a JSON Schema object describing the expected output. It SHALL return `{ provider, model, data, latencyMs }`, where `data` conforms to `schema`. A `schema` that cannot be interpreted as a JSON Schema MUST be rejected with 400 `VALIDATION_ERROR`. A `schema` nested more than 10 levels deep, or declaring more than 50 properties in total, MUST also be rejected with 400 `VALIDATION_ERROR`, however deep the nesting goes (within the request body limit). The check MUST NOT fail with a server error.

#### Scenario: Structured reply
- **WHEN** a client posts a prompt and the schema `{ "type": "object", "properties": { "options": { "type": "array", "items": { "type": "string" } } }, "required": ["options"] }`
- **THEN** the response `data` is an object whose `options` is an array of strings

#### Scenario: Extremely deep schema
- **WHEN** a client posts a `schema` whose value nests about 20,000 levels deep and still fits within the body limit
- **THEN** the response is 400 `VALIDATION_ERROR` naming `body.schema`, no provider call is made, and no 500 is returned
