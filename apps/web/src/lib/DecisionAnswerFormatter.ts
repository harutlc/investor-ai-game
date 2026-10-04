import type { DecisionAnswer, DecisionLogEntryDto, DecisionQuestion } from '@investor/shared';

export interface AnswerRow {
  name: string;
  type: DecisionAnswer['type'];
  /** "counter", "Probably reject · 1.1", "p = 0.31". */
  display: string;
  /** 0–1. A noul's confidence is max(p, 1 − p). */
  confidence: number;
  uncertain: boolean;
}

/** Turns a decision-log entry into the rows of the brain-insights sheet. */
export class DecisionAnswerFormatter {
  /**
   * Below this confidence an answer is marked "uncertain". It matches the API's default
   * `llm.decision.minConfidence` and only affects display.
   */
  static readonly UNCERTAIN_BELOW = 0.55;

  static rows(entry: DecisionLogEntryDto): AnswerRow[] {
    if (!entry.answers) return [];
    return Object.entries(entry.answers).map(([name, answer]) =>
      DecisionAnswerFormatter.row(name, answer, entry.questions[name]),
    );
  }

  static row(name: string, answer: DecisionAnswer, question: DecisionQuestion | undefined): AnswerRow {
    const confidence =
      answer.type === 'noul' ? Math.max(answer.probability, 1 - answer.probability) : answer.confidence;
    return {
      name,
      type: answer.type,
      display: DecisionAnswerFormatter.display(answer, question),
      confidence,
      uncertain: confidence < DecisionAnswerFormatter.UNCERTAIN_BELOW,
    };
  }

  static stageLabel(stage: DecisionLogEntryDto['stage']): string {
    return stage === 'debrief' ? 'Debrief' : `Stage ${stage}`;
  }

  /** "laya · english · 412 ms". */
  static meta(entry: DecisionLogEntryDto): string {
    return [entry.provider, entry.model, `${Math.round(entry.latencyMs)} ms`].filter(Boolean).join(' · ');
  }

  private static display(answer: DecisionAnswer, question: DecisionQuestion | undefined): string {
    switch (answer.type) {
      case 'choice':
        return answer.value;
      case 'noul':
        return `p = ${answer.probability.toFixed(2)}`;
      case 'score': {
        const level = Math.round(answer.value);
        const criterion = question?.type === 'score' ? question.criteria[level] : undefined;
        const label = typeof criterion === 'string' ? criterion : `level ${level}`;
        return `${label} · ${answer.value.toFixed(1)}`;
      }
    }
  }
}
