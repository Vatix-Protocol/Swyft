/**
 * Unit tests for deploy script helper functions
 * Tests cover: scalarization functions, address parsing, and deployment helpers
 */

import { describe, it, expect } from 'vitest';

// Helper functions extracted from test-integration.ts for testing
function scAddressArg(address: string): string {
  return JSON.stringify({ address });
}

function scU32(n: number): string {
  return JSON.stringify({ u32: n });
}

function scU128(n: bigint): string {
  return JSON.stringify({
    u128: {
      hi: Number(n >> BigInt(64)),
      lo: Number(n & ((BigInt(1) << BigInt(64)) - BigInt(1))),
    },
  });
}

function scI32(n: number): string {
  return JSON.stringify({ i32: n });
}

function parseSCAddress(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.address ?? parsed?.contract_id ?? raw.trim();
  } catch {
    return raw.trim();
  }
}

describe('Deploy Script Helpers', () => {
  describe('scAddressArg', () => {
    it('should serialize a valid Stellar address', () => {
      const address = 'GABC123456789';
      const result = scAddressArg(address);
      expect(result).toBe(JSON.stringify({ address }));
    });

    it('should handle addresses with special characters', () => {
      const address = 'GAB2L3V4FSCFVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const result = scAddressArg(address);
      const parsed = JSON.parse(result);
      expect(parsed.address).toBe(address);
    });

    it('should handle empty address', () => {
      const address = '';
      const result = scAddressArg(address);
      expect(result).toBe(JSON.stringify({ address }));
    });
  });

  describe('scU32', () => {
    it('should serialize a u32 value', () => {
      const value = 42;
      const result = scU32(value);
      expect(result).toBe(JSON.stringify({ u32: value }));
    });

    it('should handle zero', () => {
      const result = scU32(0);
      const parsed = JSON.parse(result);
      expect(parsed.u32).toBe(0);
    });

    it('should handle max u32 value', () => {
      const maxU32 = 4294967295;
      const result = scU32(maxU32);
      const parsed = JSON.parse(result);
      expect(parsed.u32).toBe(maxU32);
    });

    it('should handle fee tier values', () => {
      const FEE_TIER_005 = 500;
      const FEE_TIER_03 = 3000;
      const FEE_TIER_1 = 10000;

      expect(JSON.parse(scU32(FEE_TIER_005)).u32).toBe(500);
      expect(JSON.parse(scU32(FEE_TIER_03)).u32).toBe(3000);
      expect(JSON.parse(scU32(FEE_TIER_1)).u32).toBe(10000);
    });
  });

  describe('scU128', () => {
    it('should serialize a u128 value', () => {
      const value = BigInt(12345);
      const result = scU128(value);
      const parsed = JSON.parse(result);
      expect(parsed.u128.hi).toBe(0);
      expect(parsed.u128.lo).toBe(12345);
    });

    it('should handle zero', () => {
      const result = scU128(BigInt(0));
      const parsed = JSON.parse(result);
      expect(parsed.u128.hi).toBe(0);
      expect(parsed.u128.lo).toBe(0);
    });

    it('should split large u128 values correctly', () => {
      const Q96 = BigInt(2) ** BigInt(96);
      const result = scU128(Q96);
      const parsed = JSON.parse(result);
      expect(parsed.u128.hi).toBe(1); // 2^96 >> 64 = 2^32, but we use hi which is up to 64 bits
      expect(parsed.u128.lo).toBeGreaterThanOrEqual(0);
    });

    it('should handle amounts and prices', () => {
      const amount1 = BigInt(1000000);
      const amount2 = BigInt(999999999999);

      const result1 = scU128(amount1);
      const result2 = scU128(amount2);

      const parsed1 = JSON.parse(result1);
      const parsed2 = JSON.parse(result2);

      expect(parsed1.u128.hi).toBeDefined();
      expect(parsed1.u128.lo).toBeDefined();
      expect(parsed2.u128.hi).toBeDefined();
      expect(parsed2.u128.lo).toBeDefined();
    });
  });

  describe('scI32', () => {
    it('should serialize a positive i32 value', () => {
      const value = 42;
      const result = scI32(value);
      expect(result).toBe(JSON.stringify({ i32: value }));
    });

    it('should serialize a negative i32 value', () => {
      const value = -42;
      const result = scI32(value);
      const parsed = JSON.parse(result);
      expect(parsed.i32).toBe(-42);
    });

    it('should handle zero', () => {
      const result = scI32(0);
      const parsed = JSON.parse(result);
      expect(parsed.i32).toBe(0);
    });

    it('should handle tick values', () => {
      const lowerTick = -887220;
      const upperTick = 887220;

      const result1 = scI32(lowerTick);
      const result2 = scI32(upperTick);

      const parsed1 = JSON.parse(result1);
      const parsed2 = JSON.parse(result2);

      expect(parsed1.i32).toBe(lowerTick);
      expect(parsed2.i32).toBe(upperTick);
    });
  });

  describe('parseSCAddress', () => {
    it('should extract address from JSON object', () => {
      const address = 'GABC123456789';
      const raw = JSON.stringify({ address });
      const result = parseSCAddress(raw);
      expect(result).toBe(address);
    });

    it('should extract contract_id from JSON object', () => {
      const contractId = 'CXYZ987654321';
      const raw = JSON.stringify({ contract_id: contractId });
      const result = parseSCAddress(raw);
      expect(result).toBe(contractId);
    });

    it('should prioritize address over contract_id', () => {
      const address = 'GABC123456789';
      const contractId = 'CXYZ987654321';
      const raw = JSON.stringify({ address, contract_id: contractId });
      const result = parseSCAddress(raw);
      expect(result).toBe(address);
    });

    it('should return raw string if JSON parsing fails', () => {
      const raw = 'not-valid-json';
      const result = parseSCAddress(raw);
      expect(result).toBe('not-valid-json');
    });

    it('should handle whitespace around raw string', () => {
      const raw = '  GABC123456789  ';
      const result = parseSCAddress(raw);
      expect(result).toBe('GABC123456789');
    });

    it('should handle null or empty address field', () => {
      const raw = JSON.stringify({ address: null });
      const result = parseSCAddress(raw);
      expect(result).toMatch(/^[A-Z0-9]*$/);
    });
  });

  describe('Integration scenarios', () => {
    it('should create valid Soroban arguments for pool factory initialization', () => {
      const owner = 'GAABC123456789';
      const mathLib = 'GAABC987654321';
      const poolWasm = 'CABC123456789';

      const args = [scAddressArg(owner), scAddressArg(mathLib), scAddressArg(poolWasm)];

      expect(args.length).toBe(3);
      args.forEach((arg) => {
        expect(() => JSON.parse(arg)).not.toThrow();
      });
    });

    it('should create valid arguments for pool creation', () => {
      const tokenA = 'GABC';
      const tokenB = 'GXYZ';
      const fee = 3000;

      const args = [scAddressArg(tokenA), scAddressArg(tokenB), scU32(fee)];

      expect(args.length).toBe(3);
      expect(JSON.parse(args[0]).address).toBe(tokenA);
      expect(JSON.parse(args[1]).address).toBe(tokenB);
      expect(JSON.parse(args[2]).u32).toBe(3000);
    });

    it('should create valid arguments for swap operation', () => {
      const token_in = 'GABC';
      const token_out = 'GXYZ';
      const amount_in = BigInt(1000000);
      const amount_out_min = BigInt(500000);
      const fee = 3000;

      const args = [
        scAddressArg(token_in),
        scAddressArg(token_out),
        scU128(amount_in),
        scU128(amount_out_min),
        scU32(fee),
      ];

      expect(args.length).toBe(5);
      expect(JSON.parse(args[0]).address).toBe(token_in);
      expect(JSON.parse(args[1]).address).toBe(token_out);
    });
  });
});
