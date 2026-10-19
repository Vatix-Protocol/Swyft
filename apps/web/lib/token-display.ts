import type { Token } from '@swyft/ui';

const UNKNOWN_TOKEN_PREFIX = '?';

/**
 * Creates a Token from a contract address or symbol.
 * If a real symbol is provided or the input is a short symbol (<= 8 chars),
 * returns a Token with that symbol and name.
 * Otherwise, returns a fallback Token with a visually distinguishable symbol
 * (prefixed with '?') and an accessible name indicating an unknown token.
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
