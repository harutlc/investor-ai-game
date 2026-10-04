import type {
  ChatMessage,
  DecisionInsightsDto,
  GameSessionDto,
  GameSummaryDto,
  InvestorPersonaDto,
  Offer,
  PlayerOption,
  TurnResultDto,
} from '@investor/shared';

export const GAME_ID = '6f1c2a52-6d0e-4a7e-9a37-2f5b2f6f0d11';
export const CREATED_AT = '2026-10-03T10:00:00.000Z';

export const SHARK: InvestorPersonaDto = {
  id: 'greedy-shark',
  name: 'Rex Calloway',
  avatar: '🦈',
  tagline: 'Wants the biggest slice and haggles for every point.',
  traits: ['greedy', 'tough haggler'],
};

export const ANGEL: InvestorPersonaDto = {
  id: 'generous-angel',
  name: 'Grace Okafor',
  avatar: '😇',
  tagline: 'Backs founders on founder-friendly terms.',
  traits: ['generous', 'warm'],
};

export const PITCH = {
  name: 'GreenCharge',
  sector: 'EV charging',
  description: 'Fast chargers for apartment buildings.',
  valuation: 2_000_000,
  askAmount: 500_000,
};

/** A valid offer: the implied post-money valuation is computed like the API does. */
export function offer(investment: number, equity: number, from: Offer['from'] = 'investor', turn = 0): Offer {
  return { investment, equity, impliedValuation: Math.round(investment / (equity / 100)), from, turn };
}

let messageCounter = 0;
export function message(role: ChatMessage['role'], text: string): ChatMessage {
  messageCounter += 1;
  const suffix = String(messageCounter).padStart(12, '0');
  return { id: `00000000-0000-4000-8000-${suffix}`, role, text, createdAt: CREATED_AT };
}

export const OPTIONS: PlayerOption[] = [
  { id: 'opt-1-1', kind: 'counter', label: 'Counter: €500k for 15%', offer: offer(500_000, 15, 'player', 1) },
  { id: 'opt-1-2', kind: 'message', label: 'Ask why 30%' },
  { id: 'opt-1-accept', kind: 'accept', label: 'Accept €500k for 30%' },
  { id: 'opt-1-decline', kind: 'decline', label: 'Walk away' },
];

export function session(overrides: Partial<GameSessionDto> = {}): GameSessionDto {
  return {
    id: GAME_ID,
    persona: SHARK,
    pitch: PITCH,
    status: 'negotiating',
    phase: 'term_negotiation',
    turn: 0,
    maxTurns: 15,
    currentInvestorOffer: offer(500_000, 30),
    lastPlayerOffer: null,
    meters: { interestLevel: 'medium', patienceHint: 'Arms crossed, listening' },
    messages: [
      message('system', 'Negotiation started with Rex Calloway.'),
      message('investor', "Here's my number: €500k for 30%."),
    ],
    options: OPTIONS,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

export function turnResult(overrides: Partial<GameSessionDto> = {}): TurnResultDto {
  const player = message('player', '€500k for 20%.');
  const investor = message('investor', "I'll come down to 26%.");
  const base = session();
  return {
    session: session({
      turn: 1,
      currentInvestorOffer: offer(500_000, 26, 'investor', 1),
      lastPlayerOffer: offer(500_000, 20, 'player', 1),
      meters: { interestLevel: 'medium', patienceHint: 'Tapping the table' },
      messages: [...base.messages, player, investor],
      ...overrides,
    }),
    newMessages: [player, investor],
  };
}

export function summary(overrides: Partial<GameSummaryDto> = {}): GameSummaryDto {
  return {
    id: GAME_ID,
    persona: SHARK,
    startupName: 'GreenCharge',
    status: 'negotiating',
    turn: 2,
    maxTurns: 15,
    currentInvestorOffer: offer(500_000, 26, 'investor', 2),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

export const INSIGHTS: DecisionInsightsDto = {
  entries: [
    {
      turn: 1,
      stage: 'B',
      provider: 'laya',
      model: 'english',
      questions: {
        accept: {
          type: 'score',
          instructions: 'Would you accept?',
          criteria: [
            'Definitely reject',
            'Probably reject',
            'Uncertain',
            'Probably accept',
            'Definitely accept',
          ],
        },
        reaction: {
          type: 'choice',
          instructions: 'How do you react?',
          criteria: { accept: null, counter: null, reject: null },
        },
        good_deal: { type: 'noul', instructions: 'Is this a good deal?' },
      },
      answers: {
        accept: { type: 'score', value: 1.1, confidence: 0.82, probabilities: { '1': 0.82 } },
        reaction: { type: 'choice', value: 'counter', confidence: 0.49, probabilities: { counter: 0.49 } },
        good_deal: { type: 'noul', probability: 0.31 },
      },
      errorCode: null,
      latencyMs: 412,
      createdAt: CREATED_AT,
    },
    {
      turn: 2,
      stage: 'A',
      provider: 'laya',
      model: null,
      questions: { intent: { type: 'choice', instructions: 'Intent?', criteria: { a: null, b: null } } },
      answers: null,
      errorCode: 'PROVIDER_UNAVAILABLE',
      latencyMs: 10_000,
      createdAt: CREATED_AT,
    },
  ],
};
