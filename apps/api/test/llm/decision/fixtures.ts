/** The tutor's example question set: one of each primitive. */
export const tutorQuestions = {
  accept: {
    type: 'score',
    instructions: "How likely is the investor to accept the player's offer?",
    criteria: ['Definitely reject', 'Probably reject', 'Uncertain', 'Probably accept', 'Definitely accept'],
  },
  reaction: {
    type: 'choice',
    instructions: 'How should the investor react?',
    criteria: {
      accept: 'Accept the offer',
      counter: 'Make a counter-offer',
      reject: 'Reject the offer',
      walk_away: 'End the negotiation',
    },
  },
  good_deal: {
    type: 'noul',
    instructions: "The player's offer is attractive enough for the investor",
  },
} as const;

export const tutorState = {
  player_offer: { investment: 500000, equity: 15 },
  investor: { budget: 700000, max_equity: 30, interest: 0.72, patience: 3 },
  history: ['Investor offered €500k for 30%', 'Player rejected'],
};

/** Wire answers as Jev/Laya return them for `tutorQuestions`. */
export const tutorWireAnswers = {
  accept: {
    type: 'score',
    score: 1.2,
    confidence: 0.61,
    legend: {},
    probabilities: { '0': 0.2, '1': 0.5, '2': 0.2, '3': 0.07, '4': 0.03 },
  },
  reaction: {
    type: 'choice',
    choice: 'counter',
    confidence: 0.8,
    probabilities: { accept: 0.02, counter: 0.9, reject: 0.06, walk_away: 0.02 },
    answer_confidence: 0.93, // Laya-only extra field: must be ignored
  },
  good_deal: { type: 'noul', noul: 0.31 },
};
