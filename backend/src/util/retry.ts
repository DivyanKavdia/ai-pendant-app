export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Parse a Gemini duration string such as "1.250s" into milliseconds. */
export function offsetToMs(offset: string | undefined): number {
  if (!offset) return 0;
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(offset.trim());
  if (match?.[1]) return Math.round(Number(match[1]) * 1000);
  const numeric = Number(offset);
  return Number.isFinite(numeric) ? Math.round(numeric * 1000) : 0;
}

/** Clamp a value into a range, used to keep model-reported offsets honest. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
