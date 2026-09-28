/**
 * API `feeApr` is already a percentage, calculated as
 * `(fees24h / tvl) * 365 * 100` (see docs/FEE_APR_CALCULATION.md).
 */
export function formatFeeApr(value: number | string): string {
  const apr = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(apr) && apr >= 0 ? `${apr.toFixed(2)}%` : 'N/A';
}
