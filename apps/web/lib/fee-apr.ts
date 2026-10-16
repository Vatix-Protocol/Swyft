/**
 * Formats a fee APR value for display.
 *
 * The API value is already a percentage computed as `(fees24h / tvl) * 365 * 100`,
 * so it is rendered as-is with two decimal places. Non-finite, negative, and
 * empty/whitespace inputs are rendered as the `'N/A'` sentinel.
 */
export function formatFeeApr(value: number | string): string {
  if (typeof value === 'string' && value.trim() === '') {
    return 'N/A';
  }

  const apr = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(apr) || apr < 0) {
    return 'N/A';
  }

  return `${apr.toFixed(2)}%`;
}
