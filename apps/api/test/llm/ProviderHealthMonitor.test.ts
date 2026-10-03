import { describe, expect, it, vi } from 'vitest';
import { ProviderHealthMonitor } from '../../src/llm/ProviderHealthMonitor.js';
import { captureLogger } from '../support/silentLogger.js';

function pingable(name: string, ping: () => Promise<void> = () => Promise.resolve()) {
  return { name, ping: vi.fn(ping) };
}

function monitor(
  thinking = pingable('ollama'),
  decision = pingable('laya'),
  options: { cacheMs?: number; timeoutMs?: number } = {},
) {
  let now = 1_000;
  const { logger, lines } = captureLogger();
  const health = new ProviderHealthMonitor(
    { thinking, decision },
    {
      cacheMs: options.cacheMs ?? 30_000,
      logger,
      now: () => now,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    },
  );
  return { health, thinking, decision, lines, advance: (ms: number) => (now += ms) };
}

describe('ProviderHealthMonitor', () => {
  it('reports ok for both reachable providers', async () => {
    await expect(monitor().health.status()).resolves.toEqual({ thinking: 'ok', decision: 'ok' });
  });

  it('reports error for a failing provider and logs its name', async () => {
    const { health, lines } = monitor(pingable('ollama', () => Promise.reject(new Error('ECONNREFUSED'))));
    await expect(health.status()).resolves.toEqual({ thinking: 'error', decision: 'ok' });
    expect(lines.join('')).toContain('"provider":"ollama"');
  });

  it('caches results within the TTL and refreshes after it', async () => {
    const { health, thinking, advance } = monitor();
    await health.status();
    advance(29_999);
    await health.status();
    expect(thinking.ping).toHaveBeenCalledTimes(1);
    advance(2);
    await health.status();
    expect(thinking.ping).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight check between concurrent callers', async () => {
    let release!: () => void;
    const slow = pingable('anthropic', () => new Promise<void>((resolve) => (release = resolve)));
    const { health } = monitor(slow);
    const first = health.status();
    const second = health.status();
    release();
    await Promise.all([first, second]);
    expect(slow.ping).toHaveBeenCalledTimes(1);
  });

  it('turns a hanging ping into error after the timeout', async () => {
    const hanging = pingable('jev', () => new Promise<void>(() => undefined));
    const { health } = monitor(pingable('ollama'), hanging, { timeoutMs: 20 });
    await expect(health.status()).resolves.toEqual({ thinking: 'ok', decision: 'error' });
  });
});
