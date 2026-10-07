import type { DecisionAnswer } from '@investor/shared';
import { ProviderUnavailableError } from '../errors/ProviderUnavailableError.js';
import {
  validateDecisionRequest,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionResult,
  type QuestionSet,
} from './DecisionProvider.js';

type ScriptedAnswers = Record<string, DecisionAnswer> | Error;

/**
 * Offline decision provider. Scripted answers are served FIFO (and merged over the defaults); otherwise
 * it answers deterministically: first choice label, noul 0.5, middle score level.
 */
export class FakeDecisionProvider implements DecisionProvider {
  readonly name = 'fake' as const;
  readonly requests: DecisionRequest[] = [];
  private readonly script: ScriptedAnswers[] = [];
  private healthy = true;

  constructor(script: ScriptedAnswers[] = []) {
    this.script.push(...script);
  }

  enqueue(...answers: ScriptedAnswers[]): this {
    this.script.push(...answers);
    return this;
  }

  setHealthy(healthy: boolean): this {
    this.healthy = healthy;
    return this;
  }

  async decide<const Q extends QuestionSet>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
    await Promise.resolve();
    validateDecisionRequest(request);
    this.requests.push(request);
    const scripted = this.script.shift();
    if (scripted instanceof Error) throw scripted;
    const answers = { ...FakeDecisionProvider.defaults(request.questions), ...scripted };
    return {
      provider: this.name,
      model: 'fake',
      answers: answers as DecisionResult<Q>['answers'],
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
    };
  }

  decideMany(requests: readonly DecisionRequest[]): Promise<DecisionResult[]> {
    return Promise.all(requests.map((request) => this.decide(request)));
  }

  ping(): Promise<void> {
    return this.healthy ? Promise.resolve() : Promise.reject(new ProviderUnavailableError());
  }

  static defaults(questions: QuestionSet): Record<string, DecisionAnswer> {
    const answers: Record<string, DecisionAnswer> = {};
    for (const [name, question] of Object.entries(questions)) {
      if (question.type === 'choice') {
        const labels = Object.keys(question.criteria);
        answers[name] = {
          type: 'choice',
          value: labels[0]!,
          confidence: 1,
          probabilities: Object.fromEntries(labels.map((label) => [label, 1 / labels.length])),
        };
      } else if (question.type === 'noul') {
        answers[name] = { type: 'noul', probability: 0.5 };
      } else {
        const levels = question.criteria.length;
        const middle = Math.floor((levels - 1) / 2);
        answers[name] = {
          type: 'score',
          value: middle,
          confidence: 1,
          probabilities: Object.fromEntries(
            question.criteria.map((_, level) => [String(level), level === middle ? 1 : 0]),
          ),
        };
      }
    }
    return answers;
  }
}
