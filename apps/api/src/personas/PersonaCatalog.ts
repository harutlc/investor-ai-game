import { InvestorPersona } from './InvestorPersona.js';
import { PersonaDefinitionError } from './PersonaDefinitionError.js';
import { PersonaDefinitionSchema } from './PersonaDefinitionSchema.js';
import { PERSONA_DEFINITIONS } from './personaDefinitions.js';

/**
 * The investors a player can choose from. Every definition is validated when the catalog is built, so a
 * broken persona stops startup instead of surfacing mid-game.
 */
export class PersonaCatalog {
  private readonly personas: readonly InvestorPersona[];
  private readonly byId: ReadonlyMap<string, InvestorPersona>;

  constructor(definitions: readonly unknown[] = PERSONA_DEFINITIONS) {
    const issues: string[] = [];
    const personas: InvestorPersona[] = [];
    const seen = new Set<string>();

    definitions.forEach((definition, index) => {
      const label = PersonaCatalog.label(definition, index);
      const result = PersonaDefinitionSchema.safeParse(definition);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push(`${label}: ${issue.path.join('.') || '(root)'} ${issue.message}`);
        }
        return;
      }
      if (seen.has(result.data.id)) {
        issues.push(`${label}: id is used by more than one persona`);
        return;
      }
      seen.add(result.data.id);
      personas.push(new InvestorPersona(result.data));
    });

    if (issues.length > 0) throw new PersonaDefinitionError(issues);
    this.personas = Object.freeze(personas);
    this.byId = new Map(personas.map((persona) => [persona.id, persona]));
  }

  /** All personas, in catalog order. */
  list(): readonly InvestorPersona[] {
    return this.personas;
  }

  findById(id: string): InvestorPersona | undefined {
    return this.byId.get(id);
  }

  private static label(definition: unknown, index: number): string {
    const id = (definition as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id ? id : `persona #${index + 1}`;
  }
}
