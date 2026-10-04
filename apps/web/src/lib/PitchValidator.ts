import { StartupPitchSchema, type StartupPitch } from '@investor/shared';

export type PitchField = keyof StartupPitch;
export type PitchErrors = Partial<Record<PitchField, string>>;

/** The pitch form's state: numbers stay strings while the player types. */
export interface PitchDraft {
  name: string;
  sector: string;
  description: string;
  valuation: string;
  askAmount: string;
}

const MESSAGES: Record<PitchField, string> = {
  name: "Enter your startup's name (up to 80 characters).",
  sector: 'Enter a sector (up to 60 characters).',
  description: 'Describe what it does (up to 2,000 characters).',
  valuation: 'Enter a whole number of euros above 0.',
  askAmount: 'Enter a whole number of euros above 0.',
};

const FIELDS = Object.keys(MESSAGES) as PitchField[];

/** Validates the pitch form with the API's own pitch schema, field by field. */
export class PitchValidator {
  static readonly DEFAULT_DRAFT: PitchDraft = {
    name: 'GreenCharge',
    sector: 'EV charging',
    description: 'Fast EV chargers for apartment buildings. €18k monthly revenue, growing 12% a month.',
    valuation: '2000000',
    askAmount: '500000',
  };

  static validate(draft: PitchDraft): { pitch: StartupPitch | null; errors: PitchErrors } {
    const result = StartupPitchSchema.safeParse({
      name: draft.name,
      sector: draft.sector,
      description: draft.description,
      valuation: PitchValidator.toNumber(draft.valuation),
      askAmount: PitchValidator.toNumber(draft.askAmount),
    });
    if (result.success) return { pitch: result.data, errors: {} };
    const errors: PitchErrors = {};
    for (const issue of result.error.issues) {
      const field = PitchValidator.field(issue.path[0]);
      if (field) errors[field] = MESSAGES[field];
    }
    return { pitch: null, errors };
  }

  /** Field errors from a 400 response's details (`[{ path: "body.pitch.askAmount", message }]`). */
  static fromServerDetails(details: unknown): PitchErrors {
    const errors: PitchErrors = {};
    if (!Array.isArray(details)) return errors;
    for (const detail of details as unknown[]) {
      if (typeof detail !== 'object' || detail === null) continue;
      const { path, message } = detail as { path?: unknown; message?: unknown };
      if (typeof path !== 'string' || !path.startsWith('body.pitch.')) continue;
      const field = PitchValidator.field(path.split('.')[2]);
      if (field)
        errors[field] = typeof message === 'string' ? `${MESSAGES[field]} (${message})` : MESSAGES[field];
    }
    return errors;
  }

  /** Empty or non-numeric text becomes NaN, which the schema rejects. */
  static toNumber(text: string): number {
    return text.trim() === '' ? Number.NaN : Number(text);
  }

  private static field(key: unknown): PitchField | null {
    return FIELDS.find((field) => field === key) ?? null;
  }
}
