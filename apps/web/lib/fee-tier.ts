/**
 * Formats a pool fee tier (hundredths of a basis point, e.g. 3000 = 0.30%)
 * as a percentage with two decimals. Uses integer math on the digits the API
 * sent, so the label never picks up float noise like `3000.0000001`.
 * Returns the raw value unchanged when it is not a non-negative integer.
 */
export function formatFeeTier(feeTier: string | number): string {
  const raw = String(feeTier).trim();
  if (!/^\d+$/.test(raw)) return raw;
  // percent * 100 = feeTier / 100, rounded half-up to two decimals.
  const hundredths = (BigInt(raw) + 50n) / 100n;
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}%`;
}
