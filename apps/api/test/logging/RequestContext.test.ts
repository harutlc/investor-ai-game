import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { RequestContext } from '../../src/logging/RequestContext.js';

describe('RequestContext', () => {
  it('is empty outside a request', () => {
    expect(RequestContext.get()).toBeUndefined();
  });

  it('keeps interleaved requests apart across awaits', async () => {
    const seen = (id: string, delay: number) =>
      RequestContext.run({ requestId: id }, async () => {
        await sleep(delay);
        const first = RequestContext.get()?.requestId;
        await sleep(delay);
        return [first, RequestContext.get()?.requestId];
      });
    const [a, b] = await Promise.all([seen('a', 10), seen('b', 1)]);
    expect(a).toEqual(['a', 'a']);
    expect(b).toEqual(['b', 'b']);
  });
});
