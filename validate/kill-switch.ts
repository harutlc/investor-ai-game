// Launch validation (kill-switch, 2026-11-01T20:21:59.762Z): a small change for Gitunic to review.
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
