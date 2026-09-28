import { describe, expect, it } from 'vitest';
import { validateMainnetManifest } from '../check-mainnet-addresses.js';

const address = (prefix: 'C' | 'G') => `${prefix}${'A'.repeat(55)}`;

describe('validateMainnetManifest', () => {
  it('requires an approved review and mainnet addresses', () => {
    expect(
      validateMainnetManifest({
        network: 'mainnet',
        deployer: address('G'),
        contracts: { router: address('C') },
        review: { approved: true, reviewer: 'release', reviewedAt: '2026-09-28' },
      })
    ).toEqual([]);
  });

  it('rejects testnet and placeholder addresses', () => {
    const errors = validateMainnetManifest({
      network: 'testnet',
      deployer: 'GDEPLOYER',
      contracts: { router: 'CROUTERADDRESS' },
      review: { approved: false },
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        'network must be "mainnet"',
        'review.approved must be true',
        'reviewer and reviewedAt are required',
        'deployer must be a valid Stellar account address',
        'contracts.router must be a valid Stellar contract address',
      ])
    );
  });
});
