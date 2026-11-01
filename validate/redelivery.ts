// Launch validation (redelivery, 2026-11-01T20:24:29.752Z): a small change for Gitunic to review.
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
