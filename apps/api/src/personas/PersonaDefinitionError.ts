/** Thrown at startup when a persona definition is invalid. Each issue names the persona id and field. */
export class PersonaDefinitionError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid investor personas:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'PersonaDefinitionError';
  }
}
