import { describe, expect, it } from 'vitest';
import { PersonaCatalog } from '../../src/personas/PersonaCatalog.js';
import { PersonaDefinitionError } from '../../src/personas/PersonaDefinitionError.js';
import { definition } from '../support/personaFixtures.js';

const catalog = new PersonaCatalog();
const numbers = (id: string) => catalog.findById(id)!.numbers;
const all = catalog.list().map((persona) => ({ id: persona.id, ...persona.numbers }));
const minOf = (key: 'minEquity' | 'patience' | 'concessionStep') => Math.min(...all.map((p) => p[key]));
const maxOf = (key: 'maxEquity' | 'patience' | 'concessionStep') => Math.max(...all.map((p) => p[key]));

function catalogError(definitions: unknown[]): PersonaDefinitionError {
  try {
    new PersonaCatalog(definitions);
  } catch (error) {
    if (error instanceof PersonaDefinitionError) return error;
    throw error;
  }
  throw new Error('expected PersonaDefinitionError');
}

describe('PersonaCatalog', () => {
  it('contains exactly the six personas in order', () => {
    expect(catalog.list().map((persona) => persona.id)).toEqual([
      'greedy-shark',
      'generous-angel',
      'angry-rude',
      'content-well-fed',
      'skeptical-analyst',
      'impact-investor',
    ]);
  });

  it('finds a persona by id', () => {
    expect(catalog.findById('skeptical-analyst')?.name).toBe('Dr. Mira Chen');
    expect(catalog.findById('unknown')).toBeUndefined();
  });

  it('names the persona and field of an invalid definition', () => {
    const error = catalogError([{ ...definition, numbers: { ...definition.numbers, minEquity: 35 } }]);
    expect(error.message).toContain('test-investor: numbers.minEquity');
  });

  it('labels a definition without an id by its position', () => {
    const { id: _id, ...withoutId } = definition;
    expect(catalogError([definition, withoutId]).message).toContain('persona #2: id');
  });

  it('rejects duplicate ids', () => {
    expect(catalogError([definition, definition]).message).toContain(
      'test-investor: id is used by more than one persona',
    );
  });
});

describe('persona numbers', () => {
  it('make the greedy shark take the most equity and concede the least', () => {
    expect(numbers('greedy-shark').maxEquity).toBe(maxOf('maxEquity'));
    expect(numbers('greedy-shark').concessionStep).toBe(minOf('concessionStep'));
    expect(all.filter((p) => p.maxEquity === maxOf('maxEquity'))).toHaveLength(1);
    expect(all.filter((p) => p.concessionStep === minOf('concessionStep'))).toHaveLength(1);
  });

  it('make the generous angel ask the least equity and concede the most', () => {
    expect(numbers('generous-angel').minEquity).toBe(minOf('minEquity'));
    expect(numbers('generous-angel').concessionStep).toBe(maxOf('concessionStep'));
    expect(all.filter((p) => p.minEquity === minOf('minEquity'))).toHaveLength(1);
    expect(all.filter((p) => p.concessionStep === maxOf('concessionStep'))).toHaveLength(1);
  });

  it('make the angry investor the least patient and the content one the most', () => {
    expect(numbers('angry-rude').patience).toBe(minOf('patience'));
    expect(numbers('content-well-fed').patience).toBe(maxOf('patience'));
    expect(all.filter((p) => p.patience === minOf('patience'))).toHaveLength(1);
    expect(all.filter((p) => p.patience === maxOf('patience'))).toHaveLength(1);
  });
});
