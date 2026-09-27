const UNIT_MS = Object.freeze({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 });

/**
 * Parses a simple duration string like "8h" or "15m" into milliseconds.
 * @param {string} value
 * @returns {number}
 */
export function parseDurationMs(value) {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error(`Unsupported duration: ${value}`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit];
}
