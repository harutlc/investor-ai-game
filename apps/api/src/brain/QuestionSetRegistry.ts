import type { BrainQuestionSet, GameFeatureFlags } from './BrainQuestionSet.js';

/**
 * The question sets the brain asks, filtered once by `game.features`: a set tied to a flag is kept only
 * when the flag is on. Registration order is kept; it decides merge order and which failure is reported.
 */
export class QuestionSetRegistry {
  private readonly enabled: readonly BrainQuestionSet[];

  constructor(sets: readonly BrainQuestionSet[], features: GameFeatureFlags) {
    const ids = new Set<string>();
    for (const set of sets) {
      if (ids.has(set.id)) throw new Error(`Duplicate question set id "${set.id}"`);
      ids.add(set.id);
    }
    this.enabled = sets.filter((set) => set.feature === undefined || features[set.feature]);
  }

  forStage<S extends BrainQuestionSet['stage']>(stage: S): Extract<BrainQuestionSet, { stage: S }>[] {
    return this.enabled.filter((set): set is Extract<BrainQuestionSet, { stage: S }> => set.stage === stage);
  }
}
