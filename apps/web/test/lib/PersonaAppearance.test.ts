import { describe, expect, it } from 'vitest';
import { PersonaAppearance } from '@/lib/PersonaAppearance';

describe('PersonaAppearance', () => {
  it('skips honorifics for initials and first name', () => {
    expect(PersonaAppearance.initials('Dr. Mira Chen')).toBe('MC');
    expect(PersonaAppearance.firstName('Dr. Mira Chen')).toBe('Mira');
    expect(PersonaAppearance.initials('Rex Calloway')).toBe('RC');
    expect(PersonaAppearance.initials('Cher')).toBe('C');
  });

  it('uses the mock colour for known personas and a stable one otherwise', () => {
    expect(PersonaAppearance.color('greedy-shark')).toBe('#1F3A5F');
    expect(PersonaAppearance.color('mystery-investor')).toBe(PersonaAppearance.color('mystery-investor'));
    expect(PersonaAppearance.color('mystery-investor')).toMatch(/^#[0-9A-F]{6}$/);
  });
});
