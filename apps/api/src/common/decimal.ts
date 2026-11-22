/**
 * Exact decimal-string helpers backed by BigInt scaled by 10^18, so amounts,
 * prices and shares never drift through IEEE-754 floats.
 */
export const DECIMAL_SCALE = 18n;
export const DECIMAL_SCALE_FACTOR = 10n ** DECIMAL_SCALE;

/**
 * Parses a decimal string into a BigInt scaled by 10^18. Returns null when the
 * value is missing or not a finite decimal, so callers can surface an explicit
 * null instead of a silent 0.
 */
export function toScaledBigInt(value: unknown): bigint | null {
  let str: string;
  if (typeof value === 'string') str = value.trim();
  else if (typeof value === 'number' || typeof value === 'bigint') {
    str = value.toString();
  } else return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(str);
  if (!match) return null;
  const sign = match[1] === '-' ? -1n : 1n;
  const fraction = (match[3] ?? '')
    .padEnd(Number(DECIMAL_SCALE), '0')
    .slice(0, Number(DECIMAL_SCALE));
  return sign * (BigInt(match[2]) * DECIMAL_SCALE_FACTOR + BigInt(fraction));
}

/** Formats a 10^18-scaled BigInt back into a minimal decimal string. */
export function fromScaledBigInt(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / DECIMAL_SCALE_FACTOR;
  const fraction = (abs % DECIMAL_SCALE_FACTOR)
    .toString()
    .padStart(Number(DECIMAL_SCALE), '0')
    .replace(/0+$/, '');
  const body = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative && abs !== 0n ? `-${body}` : body;
}

/**
 * Sums decimal strings exactly. Null/undefined or malformed values are
 * skipped rather than coerced to 0, so they never distort the total.
 */
export function sumDecimals(values: readonly unknown[]): string {
  let total = 0n;
  for (const value of values) {
    const scaled = toScaledBigInt(value);
    if (scaled !== null) total += scaled;
  }
  return fromScaledBigInt(total);
}

/** Exact a / b; returns null when either side is invalid or b is zero. */
export function divideDecimals(a: unknown, b: unknown): string | null {
  const sa = toScaledBigInt(a);
  const sb = toScaledBigInt(b);
  if (sa === null || sb === null || sb === 0n) return null;
  return fromScaledBigInt((sa * DECIMAL_SCALE_FACTOR) / sb);
}
