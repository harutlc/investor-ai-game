import type { InvestorPersonaDto } from '@investor/shared';
import type { PersonaDefinition, PersonaNumbers } from './PersonaDefinitionSchema.js';

/** An investor the player can negotiate with. Built from a validated definition. */
export class InvestorPersona {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly tagline: string;
  readonly traits: readonly string[];
  readonly personality: string;
  readonly goals: readonly string[];
  readonly toneInstructions: string;
  readonly numbers: Readonly<PersonaNumbers>;

  constructor(definition: PersonaDefinition) {
    this.id = definition.id;
    this.name = definition.name;
    this.avatar = definition.avatar;
    this.tagline = definition.tagline;
    this.traits = Object.freeze([...definition.traits]);
    this.personality = definition.personality;
    this.goals = Object.freeze([...definition.goals]);
    this.toneInstructions = definition.toneInstructions;
    this.numbers = Object.freeze({ ...definition.numbers });
  }

  /** The public profile. Copies fields by name, so anything added to the persona later stays private. */
  toPublicDto(): InvestorPersonaDto {
    return {
      id: this.id,
      name: this.name,
      avatar: this.avatar,
      tagline: this.tagline,
      traits: [...this.traits],
    };
  }
}
