import { randomUUID } from 'node:crypto';
import { ErrorCode, type DecisionQuestions, type DecisionStage } from '@investor/shared';
import type { Logger } from 'pino';
import { AppError } from '../../errors/AppError.js';
import type { DecisionLogRepository } from '../../repositories/DecisionLogRepository.js';
import type { Clock } from '../../services/PlayerService.js';
import type { DecisionProvider, DecisionRequest, DecisionResult, QuestionSet } from './DecisionProvider.js';

/** Which game call a decision belongs to. */
export interface DecisionContext {
  sessionId: string;
  turn: number;
  stage: DecisionStage;
}

/**
 * Runs a decision request for a game session and records it in `decision_logs`: questions and answers on
 * success, the error code (never the message) on failure. The caller always gets the provider's own result
 * or error; a failed log write is logged and swallowed.
 */
export class DecisionLogger {
  constructor(
    private readonly provider: DecisionProvider,
    private readonly logs: DecisionLogRepository,
    private readonly logger: Logger,
    private readonly clock: Clock = () => new Date(),
  ) {}

  async decide<const Q extends QuestionSet>(
    context: DecisionContext,
    request: DecisionRequest<Q>,
  ): Promise<DecisionResult<Q>> {
    const started = performance.now();
    try {
      const result = await this.provider.decide(request);
      this.record(context, request, {
        provider: result.provider,
        model: result.model,
        answers: result.answers,
        errorCode: null,
        latencyMs: result.latencyMs,
      });
      return result;
    } catch (error) {
      this.record(context, request, {
        provider: this.provider.name,
        model: null,
        answers: null,
        errorCode: error instanceof AppError ? error.code : ErrorCode.INTERNAL_ERROR,
        latencyMs: Math.round(performance.now() - started),
      });
      throw error;
    }
  }

  private record(
    context: DecisionContext,
    request: DecisionRequest,
    outcome: {
      provider: string;
      model: string | null;
      answers: DecisionResult['answers'] | null;
      errorCode: string | null;
      latencyMs: number;
    },
  ): void {
    try {
      this.logs.add({
        id: randomUUID(),
        ...context,
        ...outcome,
        // QuestionSet is the readonly view of DecisionQuestions; providers have already validated it.
        questions: request.questions as DecisionQuestions,
        createdAt: this.clock(),
      });
    } catch (error) {
      this.logger.error({ err: error, ...context }, 'Failed to write a decision log entry');
    }
  }
}
