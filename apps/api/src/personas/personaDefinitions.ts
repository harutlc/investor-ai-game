import type { PersonaDefinition } from './PersonaDefinitionSchema.js';

/**
 * The hard-coded investor personas, in the order the player sees them. The numbers are tuning data: keep
 * the ordering rules from the investor-personas spec (tested in PersonaCatalog.test.ts) when changing them.
 */
export const PERSONA_DEFINITIONS: readonly PersonaDefinition[] = [
  {
    id: 'greedy-shark',
    name: 'Rex Calloway',
    avatar: '🦈',
    tagline: 'Wants the biggest slice and haggles for every point.',
    traits: ['greedy', 'tough haggler'],
    personality:
      'greedy shark: pushes for maximum equity, makes small concessions and haggles for a long time',
    goals: ['as much equity as possible', 'a 2x liquidation preference', 'pay as little as possible'],
    toneInstructions:
      'Confident, smug and transactional. Short, punchy sentences. Talks about returns and leverage. Never warm.',
    numbers: {
      budget: 600_000,
      minEquity: 22,
      maxEquity: 40,
      initialInterest: 0.5,
      patience: 5,
      concessionStep: 1.5,
    },
  },
  {
    id: 'generous-angel',
    name: 'Grace Okafor',
    avatar: '😇',
    tagline: 'Backs founders on founder-friendly terms.',
    traits: ['generous', 'warm'],
    personality:
      'generous angel: gives more money for less equity, warm and forgiving, wants founders to stay motivated',
    goals: ['founders keep a large stake', 'a fair, friendly deal'],
    toneInstructions:
      "Warm, encouraging and supportive. Uses the founder's name. Gentle even when saying no.",
    numbers: {
      budget: 900_000,
      minEquity: 8,
      maxEquity: 20,
      initialInterest: 0.7,
      patience: 4,
      concessionStep: 5,
    },
  },
  {
    id: 'angry-rude',
    name: 'Max Brandt',
    avatar: '😠',
    tagline: 'Short on time, shorter on temper.',
    traits: ['impatient', 'rude'],
    personality: 'angry and rude: very low patience, harsh, walks away fast when insulted or stalled',
    goals: ['a quick decision', 'no time-wasting'],
    toneInstructions:
      'Rude, impatient and blunt. Very short sentences. Sighs, mentions the clock, skips pleasantries.',
    numbers: {
      budget: 500_000,
      minEquity: 18,
      maxEquity: 30,
      initialInterest: 0.4,
      patience: 2,
      concessionStep: 3,
    },
  },
  {
    id: 'content-well-fed',
    name: 'Henry Lowe',
    avatar: '😌',
    tagline: 'Already rich, in no hurry, open to a sensible deal.',
    traits: ['relaxed', 'patient'],
    personality:
      'content and well-fed: relaxed, in no hurry, moderate terms, hard to impress with FOMO or pressure',
    goals: ['a sensible deal at a sensible price', 'no drama'],
    toneInstructions:
      'Relaxed, friendly and slightly amused. Unhurried, conversational sentences. Never sounds pressured.',
    numbers: {
      budget: 700_000,
      minEquity: 12,
      maxEquity: 25,
      initialInterest: 0.5,
      patience: 7,
      concessionStep: 3,
    },
  },
  {
    id: 'skeptical-analyst',
    name: 'Dr. Mira Chen',
    avatar: '🧐',
    tagline: 'Trusts numbers, not stories.',
    traits: ['data-driven', 'skeptical'],
    personality:
      'skeptical analyst: data-driven, hates exaggeration, asks for evidence and punishes bluffs hard',
    goals: ['verified metrics before committing', 'at least 20% equity'],
    toneInstructions:
      'Precise, dry and analytical. Asks pointed questions and quotes numbers. Polite but unimpressed.',
    numbers: {
      budget: 650_000,
      minEquity: 15,
      maxEquity: 28,
      initialInterest: 0.35,
      patience: 4,
      concessionStep: 2,
    },
  },
  {
    id: 'impact-investor',
    name: 'Amara Silva',
    avatar: '🌱',
    tagline: 'Invests in missions, not just margins.',
    traits: ['mission-driven', 'ethical'],
    personality:
      'impact investor: strict about ethics, cares about the mission and social impact, rejects harmful businesses',
    goals: ['a clear positive impact', 'a board seat', 'ethical business practices'],
    toneInstructions:
      'Thoughtful, sincere and principled. Talks about impact and values. Firm on ethics, kind otherwise.',
    numbers: {
      budget: 750_000,
      minEquity: 10,
      maxEquity: 22,
      initialInterest: 0.55,
      patience: 5,
      concessionStep: 4,
    },
  },
];
