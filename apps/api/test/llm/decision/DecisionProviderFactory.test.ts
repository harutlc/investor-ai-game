import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../src/config/AppConfig.js';
import { DecisionProviderFactory } from '../../../src/llm/decision/DecisionProviderFactory.js';
import { FakeDecisionProvider } from '../../../src/llm/decision/FakeDecisionProvider.js';
import { SystemOneDecisionProvider } from '../../../src/llm/decision/SystemOneDecisionProvider.js';
import { jsonResponse, stubFetch } from '../../support/stubFetch.js';
import { testConfig } from '../../support/testConfig.js';

function configWith(provider: string, keys: { typesafe?: string; laya?: string } = {}): AppConfig {
  return testConfig({
    mutate: (config) => {
      (config.llm.decision as { provider: string }).provider = provider;
      if (keys.typesafe) config.secrets.typesafeApiKey = keys.typesafe;
      if (keys.laya) config.secrets.layaApiKey = keys.laya;
    },
  });
}

async function firstRequest(config: AppConfig) {
  const stub = stubFetch(() =>
    jsonResponse({
      model: 'm',
      answers: { q: { type: 'noul', noul: 0.5 } },
      usage: { input_tokens: 1, output_tokens: 0 },
    }),
  );
  const provider = DecisionProviderFactory.create(config, {
    logger: pino({ level: 'silent' }),
    fetch: stub.fetch,
  });
  await provider.decide({ state: 's', questions: { q: { type: 'noul', instructions: 'yes?' } } });
  return { provider, call: stub.calls[0]! };
}

describe('DecisionProviderFactory', () => {
  it('builds Jev with its base URL, model and key', async () => {
    const { provider, call } = await firstRequest(configWith('jev', { typesafe: 'ts-key' }));
    expect(provider).toBeInstanceOf(SystemOneDecisionProvider);
    expect(provider.name).toBe('jev');
    expect(call.url).toBe('https://jev.test/v1/systemone');
    expect((call.body as { model: string }).model).toBe('jev-latest');
    expect(call.headers.get('authorization')).toBe('Bearer ts-key');
  });

  it('builds Laya with its base URL, model and optional key', async () => {
    const { provider, call } = await firstRequest(configWith('laya', { laya: 'laya-key' }));
    expect(provider.name).toBe('laya');
    expect(call.url).toBe('http://laya.test:8000/v1/systemone');
    expect((call.body as { model: string }).model).toBe('english');
    expect(call.headers.get('authorization')).toBe('Bearer laya-key');
  });

  it('refuses Jev without a key', () => {
    expect(() =>
      DecisionProviderFactory.create(configWith('jev'), { logger: pino({ level: 'silent' }) }),
    ).toThrow(/TYPESAFE_API_KEY/);
  });

  it('builds the fake provider and rejects unknown names', () => {
    const deps = { logger: pino({ level: 'silent' }) };
    expect(DecisionProviderFactory.create(configWith('fake'), deps)).toBeInstanceOf(FakeDecisionProvider);
    expect(() => DecisionProviderFactory.create(configWith('gpt'), deps)).toThrow(
      /Unknown decision provider: gpt/,
    );
  });
});
