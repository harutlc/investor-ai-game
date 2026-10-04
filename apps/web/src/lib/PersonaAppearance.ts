import type { InvestorPersonaDto } from '@investor/shared';

const HONORIFICS = new Set(['dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'prof', 'prof.']);

/** Tile colours from the approved mock, one per persona. All carry white text at AA contrast. */
const KNOWN_COLORS: Readonly<Record<string, string>> = {
  'greedy-shark': '#1F3A5F',
  'generous-angel': '#6B3A63',
  'angry-rude': '#8C2F1B',
  'content-well-fed': '#4B5A2A',
  'skeptical-analyst': '#3D3F8F',
  'impact-investor': '#0F5C55',
};
const FALLBACK_COLORS = Object.values(KNOWN_COLORS);

/** How a persona looks in the UI: an initials tile in a colour fixed per persona id. */
export class PersonaAppearance {
  /** "Dr. Mira Chen" → "MC". */
  static initials(name: string): string {
    const words = PersonaAppearance.words(name);
    const first = words[0] ?? '?';
    const last = words.length > 1 ? words[words.length - 1]! : '';
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  }

  /** "Dr. Mira Chen" → "Mira". */
  static firstName(name: string): string {
    return PersonaAppearance.words(name)[0] ?? name;
  }

  /** The tile colour: the mock's colour for a known persona, a stable pick from the palette otherwise. */
  static color(id: string): string {
    const known = KNOWN_COLORS[id];
    if (known) return known;
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]!;
  }

  static of(persona: Pick<InvestorPersonaDto, 'id' | 'name'>) {
    return {
      initials: PersonaAppearance.initials(persona.name),
      firstName: PersonaAppearance.firstName(persona.name),
      color: PersonaAppearance.color(persona.id),
    };
  }

  private static words(name: string): string[] {
    return name
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0 && !HONORIFICS.has(word.toLowerCase()));
  }
}
