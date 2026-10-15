/** Limits `value` to the inclusive range [`min`, `max`]. Throws when the range is empty. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError(`Empty range: ${min} > ${max}`);
  return Math.min(Math.max(value, min), max);
}
