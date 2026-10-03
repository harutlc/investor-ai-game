import { describe, expect, it } from 'vitest';
import {
  ChatMessageSchema,
  GamePhaseSchema,
  GameStatusSchema,
  InvestorMetersSchema,
  OfferSchema,
  PlayerOptionSchema,
  StartupPitchSchema,
} from '../src/index.js';

const offer = { investment: 500_000, equity: 15, impliedValuation: 3_333_333, from: 'player', turn: 1 };

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('OfferSchema', () => {
  it('accepts a consistent offer', () => {
    expect(OfferSchema.safeParse(offer).success).toBe(true);
  });

  it('rejects an inconsistent implied valuation', () => {
    const result = OfferSchema.safeParse({ ...offer, impliedValuation: 2_000_000 });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('impliedValuation');
  });

  it('reports a bad equity without a valuation error', () => {
    const result = OfferSchema.safeParse({ ...offer, equity: 0 });
    expect(issuePaths(result)).toEqual(['equity']);
  });

  it('rejects unknown fields', () => {
    expect(OfferSchema.safeParse({ ...offer, budget: 700_000 }).success).toBe(false);
  });
});

describe('StartupPitchSchema', () => {
  const pitch = {
    name: 'GreenCharge',
    sector: 'EV charging',
    description: 'Fast chargers for apartment buildings.',
    valuation: 2_000_000,
    askAmount: 500_000,
  };

  it('accepts a pitch', () => {
    expect(StartupPitchSchema.safeParse(pitch).success).toBe(true);
  });

  it('rejects an empty or too-long name', () => {
    expect(StartupPitchSchema.safeParse({ ...pitch, name: ' ' }).success).toBe(false);
    expect(StartupPitchSchema.safeParse({ ...pitch, name: 'x'.repeat(81) }).success).toBe(false);
  });

  it('rejects a description over 2000 characters', () => {
    expect(StartupPitchSchema.safeParse({ ...pitch, description: 'x'.repeat(2001) }).success).toBe(false);
  });
});

describe('ChatMessageSchema', () => {
  const message = {
    id: '6f1c2a52-6d0e-4a7e-9a37-2f5b2f6f0d11',
    role: 'investor',
    text: "I'm ready to invest €500k for 30%.",
    createdAt: '2026-10-03T10:00:00.000Z',
  };

  it('accepts a message', () => {
    expect(ChatMessageSchema.safeParse(message).success).toBe(true);
  });

  it('rejects an unknown role', () => {
    const result = ChatMessageSchema.safeParse({ ...message, role: 'narrator' });
    expect(issuePaths(result)).toEqual(['role']);
  });

  it('rejects text over 4000 characters', () => {
    expect(ChatMessageSchema.safeParse({ ...message, text: 'x'.repeat(4001) }).success).toBe(false);
  });
});

describe('PlayerOptionSchema', () => {
  it('accepts a counter with an offer', () => {
    expect(
      PlayerOptionSchema.safeParse({ id: 'o1', kind: 'counter', label: 'Counter: €500k for 15%', offer })
        .success,
    ).toBe(true);
  });

  it('rejects a counter without an offer', () => {
    const result = PlayerOptionSchema.safeParse({ id: 'o1', kind: 'counter', label: 'Counter' });
    expect(issuePaths(result)).toEqual(['offer']);
  });

  it('accepts a decline without an offer', () => {
    expect(PlayerOptionSchema.safeParse({ id: 'o2', kind: 'decline', label: 'Walk away' }).success).toBe(
      true,
    );
  });

  it('rejects a label over 120 characters', () => {
    expect(PlayerOptionSchema.safeParse({ id: 'o2', kind: 'decline', label: 'x'.repeat(121) }).success).toBe(
      false,
    );
  });
});

describe('status, phase and meters', () => {
  it('rejects an unknown status', () => {
    expect(GameStatusSchema.safeParse('paused').success).toBe(false);
    expect(GameStatusSchema.safeParse('out_of_turns').success).toBe(true);
  });

  it('rejects an unknown phase', () => {
    expect(GamePhaseSchema.safeParse('auction').success).toBe(false);
    expect(GamePhaseSchema.safeParse('term_negotiation').success).toBe(true);
  });

  it('accepts hints and rejects hidden numbers', () => {
    expect(InvestorMetersSchema.safeParse({ interestLevel: 'high', patienceHint: 'Relaxed' }).success).toBe(
      true,
    );
    expect(
      InvestorMetersSchema.safeParse({ interestLevel: 'high', patienceHint: 'Relaxed', patience: 3 }).success,
    ).toBe(false);
  });
});
