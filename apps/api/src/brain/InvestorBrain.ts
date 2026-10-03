import type { ConfidenceGate } from '../llm/decision/ConfidenceGate.js';
import type { DecisionLogger } from '../llm/decision/DecisionLogger.js';
import type { BrainMove, PreparedQuestions } from './BrainQuestionSet.js';
import type { InvestorJudgment } from './InvestorJudgment.js';
import type { NegotiationState } from './NegotiationState.js';
import type { PlayerMoveInterpretation } from './PlayerMoveInterpretation.js';
import type { QuestionSetRegistry } from './QuestionSetRegistry.js';

/** One move to judge, and the game call it belongs to (for the decision log). */
export interface BrainTurn {
  sessionId: string;
  turn: number;
  state: NegotiationState;
  /** The move's text; null for a structured offer without text. */
  message: string | null;
}

interface PreparingSet<R> {
  prepare(move: BrainMove): PreparedQuestions<Partial<R>> | null;
}

/**
 * The investor's brain: asks the decision model typed questions and returns gated judgments. It never
 * acts on them; the policy does. Within a stage every applicable question set is one logged request, and
 * all of them run concurrently.
 */
export class InvestorBrain {
  constructor(
    private readonly registry: QuestionSetRegistry,
    private readonly decisions: DecisionLogger,
    private readonly gate: ConfidenceGate,
  ) {}

  /** Stage A: what a free-text move is trying to do, and which offer (if any) it contains. */
  async understand(turn: BrainTurn & { message: string }): Promise<PlayerMoveInterpretation> {
    const parts = await this.ask('A', this.registry.forStage('A'), turn);
    const { intent, injection, offer } = Object.assign({}, ...parts) as Partial<PlayerMoveInterpretation>;
    if (!intent || !injection) throw new Error('Stage A produced no intent; is the intent set registered?');
    return { intent, injection, offer: offer ?? { investment: null, equity: null } };
  }

  /** Stage B: the investor's verdict on the move. */
  async evaluate(turn: BrainTurn): Promise<InvestorJudgment> {
    const parts = await this.ask('B', this.registry.forStage('B'), turn);
    const { deal, ...rest } = Object.assign({}, ...parts) as Partial<InvestorJudgment>;
    if (!deal) throw new Error('Stage B produced no deal judgment; is the deal set registered?');
    return { ...rest, deal };
  }

  /**
   * Sends one logged request per applicable set, concurrently. Waits for all of them (so every call is
   * logged) and then rethrows the first failure in registry order, so the reported error is stable.
   */
  private async ask<R>(
    stage: 'A' | 'B',
    sets: readonly PreparingSet<R>[],
    { sessionId, turn, state, message }: BrainTurn,
  ): Promise<Partial<R>[]> {
    const prepared = sets
      .map((set) => set.prepare({ state, message }))
      .filter((questions) => questions !== null);
    const results = await Promise.allSettled(
      prepared.map(({ questions }) =>
        this.decisions.decide({ sessionId, turn, stage }, { state, questions }),
      ),
    );
    return results.map((result, index) => {
      if (result.status === 'rejected') throw result.reason;
      return prepared[index]!.interpret(result.value.answers, this.gate);
    });
  }
}
