import type { z } from 'zod';

export type JsonParseResult<T> = { ok: true; data: T } | { ok: false; issues: string };

const FENCE = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/;

/** Extracts JSON from an LLM reply (tolerating Markdown fences and prose) and validates it with zod. */
export class JsonResponseParser {
  static parse<T>(raw: string, schema: z.ZodType<T>): JsonParseResult<T> {
    const text = JsonResponseParser.extract(raw);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      return { ok: false, issues: `not valid JSON (${(error as Error).message})` };
    }
    const result = schema.safeParse(value);
    if (result.success) return { ok: true, data: result.data };
    return {
      ok: false,
      issues: result.error.issues
        .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
        .join('; '),
    };
  }

  /** The fenced block if there is one, otherwise the outermost {...} or [...] span, otherwise the trimmed text. */
  private static extract(raw: string): string {
    const fenced = FENCE.exec(raw);
    if (fenced?.[1] !== undefined) return fenced[1].trim();
    const trimmed = raw.trim();
    const start = trimmed.search(/[[{]/);
    if (start > 0) {
      const close = trimmed[start] === '{' ? '}' : ']';
      const end = trimmed.lastIndexOf(close);
      if (end > start) return trimmed.slice(start, end + 1);
    }
    return trimmed;
  }
}
