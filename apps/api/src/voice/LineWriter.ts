import { ProviderBadResponseError } from '../llm/errors/ProviderBadResponseError.js';
import { ProviderUnavailableError } from '../llm/errors/ProviderUnavailableError.js';
import type { ThinkingProvider, ThinkingRequest } from '../llm/thinking/ThinkingProvider.js';
import type { FallbackLines } from './FallbackLines.js';
import type { NumberConsistencyChecker } from './NumberConsistencyChecker.js';
import type { NumbersInPlay } from './NumbersInPlay.js';
import type { PromptBuilder } from './PromptBuilder.js';
import type { LineSubject, VoiceContext } from './VoiceContext.js';

/** Chat messages are at most this long (ChatMessageSchema). */
export const MAX_LINE_LENGTH = 4000;

export interface VoiceLine {
  text: string;
  /** True when the line is code-written because the model failed. */
  fallback: boolean;
  /** Why it fell back: `inconsistent` (numbers kept failing) or the provider's error code. */
  fallbackReason?: string;
}

/**
 * Generate → check → retry once with the problems → code-written line. Provider failures go straight to
 * the fallback, so a line is always produced; other errors are bugs and propagate.
 */
export class LineWriter {
  constructor(
    private readonly provider: ThinkingProvider,
    private readonly prompts: PromptBuilder,
    private readonly numbers: NumbersInPlay,
    private readonly checker: NumberConsistencyChecker,
    private readonly fallbacks: FallbackLines,
  ) {}

  async write(context: VoiceContext, subject: LineSubject): Promise<VoiceLine> {
    const allowed = this.numbers.for(context, subject);
    const request = this.prompts.line(context, subject);
    const review = (text: string) => {
      const line = text.trim();
      if (!line) return { line, problems: ['The line was empty.'] };
      if (line.length > MAX_LINE_LENGTH) return { line, problems: ['The line was far too long.'] };
      return { line, problems: this.checker.check(line, allowed).problems };
    };

    try {
      const first = review((await this.provider.generateText(request)).text);
      if (first.problems.length === 0) return { text: first.line, fallback: false };

      const retry: ThinkingRequest = {
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant', content: first.line || '(empty)' },
          { role: 'user', content: `That line had problems: ${first.problems.join(' ')} Write it again.` },
        ],
      };
      const second = review((await this.provider.generateText(retry)).text);
      if (second.problems.length === 0) return { text: second.line, fallback: false };
      return this.fallback(subject, 'inconsistent');
    } catch (error) {
      if (error instanceof ProviderUnavailableError || error instanceof ProviderBadResponseError) {
        return this.fallback(subject, error.code);
      }
      throw error;
    }
  }

  private fallback(subject: LineSubject, reason: string): VoiceLine {
    return { text: this.fallbacks.line(subject), fallback: true, fallbackReason: reason };
  }
}
