import type { Token } from '@swyft/ui';

const UNKNOWN_TOKEN_PREFIX = '?';

/**
 * Creates a Token from a contract address or symbol.
 * If a real symbol is provided or the input is a short symbol (<= 8 chars),
 * returns a Token with that symbol and name.
 * Otherwise, returns a fallback Token with a visually distinguishable symbol
 * (prefixed with '?') and an accessible name indicating an unknown token.
 *
 * Addresses are treated as opaque strings: truncation for layout is a plain
 * string slice (never `Number`/`parseFloat`), and the full original address is
 * kept in `id` (and `name`) so copy actions use the untruncated value.
 */
export function tokenFromAddress(address: string, symbol?: string, name?: string): Token {
  if (symbol && name) {
    return {
      id: address,
      symbol,
      name,
      logoUrl: null,
    };
  }

  if (address.length <= 8 && !address.startsWith('C') && !address.startsWith('0x')) {
    return {
      id: address,
      symbol: address,
      name: address,
      logoUrl: null,
    };
  }

  const truncated = address.length > 8 ? `${address.slice(0, 4)}…` : address;
  const fallbackSymbol = `${UNKNOWN_TOKEN_PREFIX}${truncated}`;

  return {
    id: address,
    symbol: fallbackSymbol,
    name: `Unknown token (${address})`,
    logoUrl: null,
  };
}

/**
 * Checks if a token is an unknown/fallback token.
 */
export function isUnknownToken(token: Token): boolean {
  return token.symbol.startsWith(UNKNOWN_TOKEN_PREFIX);
}

/**
 * Formats a non-negative decimal string for display without converting it to
 * a float. The fraction is truncated to `maxDecimals` digits and trailing
 * zeros are trimmed, so `"0.1000000"` renders as `"0.1"`. Non-decimal input
 * (including exponent notation such as `"1e2"`) renders as `"0"`.
 */
export function formatDecimal(value: string, maxDecimals: number): string {
  const v = value.trim();
  if (!/^\d*\.?\d*$/.test(v)) return '0';
  const [int = '', frac = ''] = v.split('.');
  const i = int.replace(/^0+(?=\d)/, '') || '0';
  const f = frac.slice(0, maxDecimals).replace(/0+$/, '');
  return f ? `${i}.${f}` : i;
}

/** True when a non-negative decimal string is greater than zero. */
export function isPositiveDecimal(value: string): boolean {
  return /^\d*\.?\d*$/.test(value.trim()) && /[1-9]/.test(value);
}
