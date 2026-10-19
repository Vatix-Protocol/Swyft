import { describe, it, expect } from 'vitest';
import { tokenFromAddress, isUnknownToken } from './token-display';

describe('token-display helpers', () => {
  describe('tokenFromAddress', () => {
    it('returns a token with the real symbol and name when metadata is provided', () => {
      const token = tokenFromAddress('0x1234567890abcdef', 'XLM', 'Stellar Lumens');
      expect(token).toEqual({
        id: '0x1234567890abcdef',
        symbol: 'XLM',
        name: 'Stellar Lumens',
        logoUrl: null,
      });
      expect(isUnknownToken(token)).toBe(false);
    });

    it('returns a token with real symbol when input is a short symbol string', () => {
      const token = tokenFromAddress('USDC');
      expect(token).toEqual({
        id: 'USDC',
        symbol: 'USDC',
        name: 'USDC',
        logoUrl: null,
      });
      expect(isUnknownToken(token)).toBe(false);
    });

    it('returns the documented fallback with an accessible name and distinct symbol when metadata is omitted', () => {
      const address = '0x1234567890abcdef1234567890abcdef';
      const token = tokenFromAddress(address);
      expect(token.id).toBe(address);
      expect(token.symbol).toBe('?0x12…');
      expect(token.name).toBe(`Unknown token (${address})`);
      expect(isUnknownToken(token)).toBe(true);
    });
  });
});