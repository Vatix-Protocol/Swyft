import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as StellarSdk from '@stellar/stellar-sdk';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { AuthService } from './auth.service';
import { VerifyWalletDto } from './dto/verify-wallet.dto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generates a real Stellar keypair + a properly-signed nonce for happy-path tests. */
function makeSignedNonce(nonce: string): {
  walletAddress: string;
  signature: string;
} {
  const keypair = StellarSdk.Keypair.random();
  const messageBytes = Buffer.from(nonce, 'utf8');
  const signatureBytes = keypair.sign(messageBytes);
  return {
    walletAddress: keypair.publicKey(),
    signature: Buffer.from(signatureBytes).toString('base64'),
  };
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRedis = {
  get: jest.fn(),
  del: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('15m'),
  getOrThrow: jest.fn().mockReturnValue('test-secret'),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe('verifyWallet — success', () => {
    it('returns an accessToken when signature is valid and nonce exists', async () => {
      const nonce = 'test-nonce-abc123';
      const { walletAddress, signature } = makeSignedNonce(nonce);

      mockRedis.get.mockResolvedValueOnce(nonce);
      mockRedis.del.mockResolvedValueOnce(1);

      const dto: VerifyWalletDto = { walletAddress, nonce, signature };
      const result = await service.verifyWallet(dto);

      expect(result).toEqual({ accessToken: 'mock.jwt.token' });
    });

    it('calls redis.del to consume the nonce after successful verification', async () => {
      const nonce = 'consume-me';
      const { walletAddress, signature } = makeSignedNonce(nonce);

      mockRedis.get.mockResolvedValueOnce(nonce);
      mockRedis.del.mockResolvedValueOnce(1);

      await service.verifyWallet({ walletAddress, nonce, signature });

      expect(mockRedis.del).toHaveBeenCalledWith(
        `${AuthService.NONCE_PREFIX}${walletAddress}`,
      );
      expect(mockRedis.del).toHaveBeenCalledTimes(1);
    });

    it('signs the JWT with the wallet address as sub', async () => {
      const nonce = 'jwt-payload-test';
      const { walletAddress, signature } = makeSignedNonce(nonce);

      mockRedis.get.mockResolvedValueOnce(nonce);
      mockRedis.del.mockResolvedValueOnce(1);

      await service.verifyWallet({ walletAddress, nonce, signature });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        { sub: walletAddress, walletAddress },
        { expiresIn: '15m' },
      );
    });

    it('uses JWT_EXPIRES_IN from ConfigService', async () => {
      mockConfigService.get.mockReturnValueOnce('30m');

      const nonce = 'expires-in-test';
      const { walletAddress, signature } = makeSignedNonce(nonce);

      mockRedis.get.mockResolvedValueOnce(nonce);
      mockRedis.del.mockResolvedValueOnce(1);

      await service.verifyWallet({ walletAddress, nonce, signature });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        { expiresIn: '30m' },
      );
    });

    it('falls back to 15m when JWT_EXPIRES_IN is not set', async () => {
      mockConfigService.get.mockReturnValueOnce(undefined);

      const nonce = 'fallback-expiry';
      const { walletAddress, signature } = makeSignedNonce(nonce);

      mockRedis.get.mockResolvedValueOnce(nonce);
      mockRedis.del.mockResolvedValueOnce(1);

      await service.verifyWallet({ walletAddress, nonce, signature });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        { expiresIn: '15m' },
      );
    });
  });

  // ── Nonce errors ───────────────────────────────────────────────────────────

  describe('verifyWallet — nonce errors', () => {
    it('throws 401 when nonce does not exist in Redis (null)', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const dto: VerifyWalletDto = {
        walletAddress: StellarSdk.Keypair.random().publicKey(),
        nonce: 'ghost-nonce',
        signature: Buffer.alloc(64).toString('base64'),
      };

      await expect(service.verifyWallet(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.verifyWallet(dto)).rejects.toThrow(
        'Nonce has expired or does not exist',
      );
    });

    it('throws 401 when the submitted nonce does not match the stored one', async () => {
      const storedNonce = 'real-nonce';
      mockRedis.get.mockResolvedValueOnce(storedNonce);

      const dto: VerifyWalletDto = {
        walletAddress: StellarSdk.Keypair.random().publicKey(),
        nonce: 'tampered-nonce',
        signature: Buffer.alloc(64).toString('base64'),
      };

      await expect(service.verifyWallet(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does NOT consume the nonce if nonce is not found', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const dto: VerifyWalletDto = {
        walletAddress: StellarSdk.Keypair.random().publicKey(),
        nonce: 'any',
        signature: Buffer.alloc(64).toString('base64'),
      };

      await expect(service.verifyWallet(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  // ── Signature errors ───────────────────────────────────────────────────────

  describe('verifyWallet — signature errors', () => {
    it('throws 401 when signature is valid base64 but signed with a different key', async () => {
      const nonce = 'right-nonce';
      const wrongKeypair = StellarSdk.Keypair.random();
      const { walletAddress } = makeSignedNonce(nonce); // different keypair

      // Sign with wrong key
      const wrongSig = Buffer.from(
        wrongKeypair.sign(Buffer.from(nonce)),
      ).toString('base64');

      mockRedis.get.mockResolvedValueOnce(nonce);

      const dto: VerifyWalletDto = {
        walletAddress,
        nonce,
        signature: wrongSig,
      };

      await expect(service.verifyWallet(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 401 when signature decodes to wrong length', async () => {
      const nonce = 'bad-sig-length';
      const { walletAddress } = makeSignedNonce(nonce);

      mockRedis.get.mockResolvedValueOnce(nonce);

      const shortSig = Buffer.alloc(32).toString('base64'); // not 64 bytes

      const dto: VerifyWalletDto = {
        walletAddress,
        nonce,
        signature: shortSig,
      };

      await expect(service.verifyWallet(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does NOT consume the nonce if signature verification fails', async () => {
      const nonce = 'no-consume-on-bad-sig';
      const { walletAddress } = makeSignedNonce(nonce);
      const badSig = Buffer.alloc(64).toString('base64');

      mockRedis.get.mockResolvedValueOnce(nonce);

      const dto: VerifyWalletDto = { walletAddress, nonce, signature: badSig };

      await expect(service.verifyWallet(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  // ── Malformed address ──────────────────────────────────────────────────────

  describe('verifyWallet — malformed wallet address', () => {
    it('throws 400 if walletAddress cannot be parsed by the Stellar SDK despite passing DTO regex', async () => {
      // Construct an address that is the right shape but is not a real public key.
      // We spy on Keypair.fromPublicKey to force the throw.
      const nonce = 'keypair-parse-fail';
      const fakeAddress = 'G' + 'A'.repeat(55);

      mockRedis.get.mockResolvedValueOnce(nonce);

      jest
        .spyOn(StellarSdk.Keypair, 'fromPublicKey')
        .mockImplementationOnce(() => {
          throw new Error('invalid public key');
        });

      const dto: VerifyWalletDto = {
        walletAddress: fakeAddress,
        nonce,
        signature: Buffer.alloc(64).toString('base64'),
      };

      await expect(service.verifyWallet(dto)).rejects.toThrow(
        BadRequestException,
      );

      jest.restoreAllMocks();
    });
  });
});
