import type { PersonaDefinition } from '../../src/personas/PersonaDefinitionSchema.js';

/** A valid persona definition that is not in the catalog. */
export const definition: PersonaDefinition = {
  id: 'test-investor',
  name: 'Test Investor',
  avatar: '🧪',
  tagline: 'Only exists in tests.',
  traits: ['careful'],
  personality: 'careful: checks everything twice',
  goals: ['at least 20% equity'],
  toneInstructions: 'Calm, short sentences.',
  numbers: {
    budget: 700_000,
    minEquity: 15,
    maxEquity: 30,
    initialInterest: 0.5,
    patience: 4,
    concessionStep: 3,
  },
};
