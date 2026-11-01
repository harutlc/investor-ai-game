// Launch validation (supersede, 2026-11-01T20:31:22.722Z): a small change for Gitunic to review.
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
