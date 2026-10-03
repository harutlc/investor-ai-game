import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JsonResponseParser } from '../../src/llm/JsonResponseParser.js';

const Options = z.object({ options: z.array(z.string()) });

describe('JsonResponseParser', () => {
  it('parses plain JSON', () => {
    expect(JsonResponseParser.parse('{"options":["a","b"]}', Options)).toEqual({
      ok: true,
      data: { options: ['a', 'b'] },
    });
  });

  it('parses a ```json fence', () => {
    expect(JsonResponseParser.parse('```json\n{"options":["a"]}\n```', Options).ok).toBe(true);
  });

  it('parses a bare ``` fence', () => {
    expect(JsonResponseParser.parse('```\n{"options":[]}\n```', Options).ok).toBe(true);
  });

  it('parses JSON after leading prose', () => {
    expect(
      JsonResponseParser.parse('Sure! Here it is:\n```json\n{"options":["x"]}\n```\nEnjoy.', Options),
    ).toEqual({
      ok: true,
      data: { options: ['x'] },
    });
    expect(JsonResponseParser.parse('Here you go: {"options":["y"]} hope it helps', Options).ok).toBe(true);
  });

  it('reports invalid JSON', () => {
    const result = JsonResponseParser.parse('{"options": [', Options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toMatch(/^not valid JSON/);
  });

  it('reports schema mismatches readably', () => {
    const result = JsonResponseParser.parse('{"options":[1]}', Options);
    expect(result).toEqual({ ok: false, issues: expect.stringContaining('options.0:') });
    const missing = JsonResponseParser.parse('{}', Options);
    if (!missing.ok) expect(missing.issues).toContain('options:');
  });
});
