import { describe, expect, it } from 'vitest';
import { InvestorPersona } from '../../src/personas/InvestorPersona.js';
import { PersonaDefinitionSchema } from '../../src/personas/PersonaDefinitionSchema.js';
import { definition } from '../support/personaFixtures.js';

describe('PersonaDefinitionSchema', () => {
  it('accepts a valid definition', () => {
    expect(PersonaDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  it('rejects minEquity above maxEquity, naming minEquity', () => {
    const result = PersonaDefinitionSchema.safeParse({
      ...definition,
      numbers: { ...definition.numbers, minEquity: 35, maxEquity: 30 },
    });
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['numbers.minEquity']);
  });

  it('rejects a patience below 1', () => {
    expect(
      PersonaDefinitionSchema.safeParse({ ...definition, numbers: { ...definition.numbers, patience: 0 } })
        .success,
    ).toBe(false);
  });
});

describe('InvestorPersona', () => {
  it('exposes exactly the five public fields', () => {
    const dto = new InvestorPersona(definition).toPublicDto();
    expect(Object.keys(dto).sort()).toEqual(['avatar', 'id', 'name', 'tagline', 'traits']);
    expect(dto).toEqual({
      id: 'test-investor',
      name: 'Test Investor',
      avatar: '🧪',
      tagline: 'Only exists in tests.',
      traits: ['careful'],
    });
  });

  it('keeps the hidden numbers on the server-side object', () => {
    const persona = new InvestorPersona(definition);
    expect(persona.numbers.budget).toBe(700_000);
    expect(Object.isFrozen(persona.numbers)).toBe(true);
  });

  it('does not share arrays with the public DTO', () => {
    const persona = new InvestorPersona(definition);
    persona.toPublicDto().traits.push('mutated');
    expect(persona.traits).toEqual(['careful']);
  });
});
