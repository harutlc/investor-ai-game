import { describe, expect, it } from 'vitest';
import type { GameFeatureFlags, StageBQuestionSet } from '../../src/brain/BrainQuestionSet.js';
import { mvpQuestionSets } from '../../src/brain/mvpQuestionSets.js';
import { QuestionSetRegistry } from '../../src/brain/QuestionSetRegistry.js';
import { testConfig } from '../support/testConfig.js';

const featuresOff: GameFeatureFlags = testConfig().game.features;
const dueDiligenceOn: GameFeatureFlags = { ...featuresOff, dueDiligence: true };

/** A v2-style set behind a feature flag. */
const dueDiligenceSet: StageBQuestionSet = {
  id: 'due_diligence',
  stage: 'B',
  feature: 'dueDiligence',
  prepare: () => null,
};

describe('QuestionSetRegistry', () => {
  it('splits the MVP sets two per stage, in registration order', () => {
    const registry = new QuestionSetRegistry(mvpQuestionSets(), featuresOff);
    expect(registry.forStage('A').map((set) => set.id)).toEqual(['intent', 'offer']);
    expect(registry.forStage('B').map((set) => set.id)).toEqual(['deal', 'conduct']);
  });

  it('leaves out a set whose feature flag is off', () => {
    const registry = new QuestionSetRegistry([...mvpQuestionSets(), dueDiligenceSet], featuresOff);
    expect(registry.forStage('B').map((set) => set.id)).toEqual(['deal', 'conduct']);
  });

  it('includes a set whose feature flag is on, in its stage', () => {
    const registry = new QuestionSetRegistry([...mvpQuestionSets(), dueDiligenceSet], dueDiligenceOn);
    expect(registry.forStage('B').map((set) => set.id)).toEqual(['deal', 'conduct', 'due_diligence']);
    expect(registry.forStage('A').map((set) => set.id)).toEqual(['intent', 'offer']);
  });

  it('rejects duplicate ids', () => {
    expect(() => new QuestionSetRegistry([dueDiligenceSet, dueDiligenceSet], featuresOff)).toThrow(
      'Duplicate question set id "due_diligence"',
    );
  });
});
