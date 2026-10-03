import { describe, expect, it } from 'vitest';
import {
  CreateGameRequestSchema,
  DecisionInsightsDtoSchema,
  GameSessionDtoSchema,
  InvestorPersonaDtoSchema,
  PersonaListDtoSchema,
  PlayTurnRequestSchema,
  TurnResultDtoSchema,
} from '../src/index.js';

const persona = {
  id: 'greedy-shark',
  name: 'Greedy Shark',
  avatar: '🦈',
  tagline: 'Wants the biggest slice.',
  traits: ['greedy', 'tough'],
};

const pitch = {
  name: 'GreenCharge',
  sector: 'EV charging',
  description: 'Fast chargers for apartment buildings.',
  valuation: 2_000_000,
  askAmount: 500_000,
};

const session = {
  id: '6f1c2a52-6d0e-4a7e-9a37-2f5b2f6f0d11',
  persona,
  pitch,
  status: 'negotiating',
  phase: 'term_negotiation',
  turn: 0,
  maxTurns: 15,
  currentInvestorOffer: {
    investment: 500_000,
    equity: 30,
    impliedValuation: 1_666_667,
    from: 'investor',
    turn: 0,
  },
  lastPlayerOffer: null,
  meters: { interestLevel: 'medium', patienceHint: 'Listening carefully' },
  messages: [],
  options: [],
  createdAt: '2026-10-03T10:00:00.000Z',
  updatedAt: '2026-10-03T10:00:00.000Z',
};

describe('InvestorPersonaDtoSchema', () => {
  it('accepts the public profile', () => {
    expect(InvestorPersonaDtoSchema.safeParse(persona).success).toBe(true);
    expect(PersonaListDtoSchema.safeParse({ personas: [persona] }).success).toBe(true);
  });

  it.each(['budget', 'maxEquity', 'personality', 'toneInstructions'])(
    'rejects the hidden field %s',
    (key) => {
      expect(InvestorPersonaDtoSchema.safeParse({ ...persona, [key]: 1 }).success).toBe(false);
    },
  );

  it('requires 1 to 4 traits', () => {
    expect(InvestorPersonaDtoSchema.safeParse({ ...persona, traits: [] }).success).toBe(false);
    expect(
      InvestorPersonaDtoSchema.safeParse({ ...persona, traits: ['a', 'b', 'c', 'd', 'e'] }).success,
    ).toBe(false);
  });
});

describe('GameSessionDtoSchema', () => {
  it('accepts a public session', () => {
    expect(GameSessionDtoSchema.safeParse(session).success).toBe(true);
    expect(TurnResultDtoSchema.safeParse({ session, newMessages: [] }).success).toBe(true);
  });

  it('rejects a budget field', () => {
    expect(GameSessionDtoSchema.safeParse({ ...session, budget: 700_000 }).success).toBe(false);
  });

  it('rejects hidden numbers inside the meters', () => {
    expect(
      GameSessionDtoSchema.safeParse({ ...session, meters: { ...session.meters, patience: 3 } }).success,
    ).toBe(false);
  });
});

describe('DecisionInsightsDtoSchema', () => {
  it('accepts a success and a failure entry', () => {
    const base = {
      turn: 1,
      stage: 'B',
      provider: 'laya',
      questions: { good_deal: { type: 'noul', instructions: 'The offer is attractive.' } },
      latencyMs: 120,
      createdAt: '2026-10-03T10:00:00.000Z',
    };
    expect(
      DecisionInsightsDtoSchema.safeParse({
        entries: [
          {
            ...base,
            model: 'english',
            answers: { good_deal: { type: 'noul', probability: 0.3 } },
            errorCode: null,
          },
          { ...base, model: null, answers: null, errorCode: 'PROVIDER_UNAVAILABLE' },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('CreateGameRequestSchema', () => {
  it('accepts a persona and a pitch', () => {
    expect(CreateGameRequestSchema.safeParse({ personaId: 'greedy-shark', pitch }).success).toBe(true);
  });

  it('rejects a malformed persona id', () => {
    expect(CreateGameRequestSchema.safeParse({ personaId: 'Greedy Shark', pitch }).success).toBe(false);
  });
});

describe('PlayTurnRequestSchema', () => {
  it('accepts free text', () => {
    expect(PlayTurnRequestSchema.safeParse({ message: '€500k for 15%' }).success).toBe(true);
  });

  it('accepts an option id or a structured offer', () => {
    expect(PlayTurnRequestSchema.safeParse({ optionId: 'o1' }).success).toBe(true);
    expect(PlayTurnRequestSchema.safeParse({ offer: { investment: 500_000, equity: 15 } }).success).toBe(
      true,
    );
  });

  it('rejects two inputs', () => {
    expect(PlayTurnRequestSchema.safeParse({ optionId: 'o1', message: 'hi' }).success).toBe(false);
  });

  it('rejects no input', () => {
    expect(PlayTurnRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a message over 1000 characters', () => {
    expect(PlayTurnRequestSchema.safeParse({ message: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('rejects a client-supplied implied valuation', () => {
    expect(
      PlayTurnRequestSchema.safeParse({ offer: { investment: 500_000, equity: 15, impliedValuation: 1 } })
        .success,
    ).toBe(false);
  });
});
