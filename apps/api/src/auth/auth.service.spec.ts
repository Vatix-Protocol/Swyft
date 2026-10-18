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
  incr: jest.fn().mockResolvedValue(1),
  ttl: jest.fn().mockResolvedValue(120),
  expire: jest.fn().mockResolvedValue(1),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'JWT_EXPIRES_IN') return '15m';
    return undefined;
  }),
  getOrThrow: jest.fn().mockReturnValue('test-secret'),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'JWT_EXPIRES_IN') return '15m';
      return undefined;
    });

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
      expect(mockRedis.del).toHaveBeenCalledWith(
        `${AuthService.ATTEMPTS_PREFIX}${walletAddress}`,
      );
      expect(mockRedis.del).toHaveBeenCalledTimes(2);
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
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'JWT_EXPIRES_IN' ? '30m' : undefined,
      );

      const nonce = 'expires-in-test';
      const { walletAddress, signature } = makeSignedNonce(nonce);

      mockRedis.get.mockResolvedValueOnce(nonce);
      mockRedis.del.mockResolvedValueOnce(1);

      await service.verifyWallet({ walletAddress, nonce, signature });

      expect(mockJwtService.sign).toHaveBeenCalledWith(expect.any(Object), {
        expiresIn: '30m',
      });
    });

    it('falls back to 15m when JWT_EXPIRES_IN is not set', async () => {
      mockConfigService.get.mockImplementation(() => undefined);

      const nonce = 'fallback-expiry';
      const { walletAddress, signature } = makeSignedNonce(nonce);

      mockRedis.get.mockResolvedValueOnce(nonce);
      mockRedis.del.mockResolvedValueOnce(1);

      await service.verifyWallet({ walletAddress, nonce, signature });

      expect(mockJwtService.sign).toHaveBeenCalledWith(expect.any(Object), {
        expiresIn: '15m',
      });
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

  // ── #776: failed attempts tracked per nonce ────────────────────────────────

  describe('verifyWallet — failed attempt tracking', () => {
    it('increments the attempts counter on a signature failure', async () => {
      const nonce = 'attempts-nonce';
      const { walletAddress } = makeSignedNonce(nonce);
      const badSig = Buffer.alloc(64).toString('base64');

      mockRedis.get.mockResolvedValueOnce(nonce);
      mockRedis.incr.mockResolvedValueOnce(1);

      await expect(
        service.verifyWallet({ walletAddress, nonce, signature: badSig }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockRedis.incr).toHaveBeenCalledWith(
        `${AuthService.ATTEMPTS_PREFIX}${walletAddress}`,
      );
    });

    it('invalidates the nonce once the default attempt limit is reached', async () => {
      const nonce = 'lockout-nonce';
      const { walletAddress } = makeSignedNonce(nonce);
      const badSig = Buffer.alloc(64).toString('base64');

      mockRedis.get.mockResolvedValueOnce(nonce);
      mockRedis.incr.mockResolvedValueOnce(
        AuthService.DEFAULT_MAX_NONCE_ATTEMPTS,
      );

      await expect(
        service.verifyWallet({ walletAddress, nonce, signature: badSig }),
      ).rejects.toThrow('Too many failed attempts; nonce invalidated');

      expect(mockRedis.del).toHaveBeenCalledWith(
        `${AuthService.NONCE_PREFIX}${walletAddress}`,
      );
    });
  });

  // ── #1205: attempt limit resolved through ConfigService ────────────────────

  describe('verifyWallet — configurable attempt limit', () => {
    const badSig = Buffer.alloc(64).toString('base64');

    /** Minimal stateful Redis so successive attempts see each other's writes. */
    function makeFakeRedis(): Record<string, jest.Mock> {
      const store = new Map<string, string>();
      return {
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        incr: jest.fn(async (key: string) => {
          const next = Number(store.get(key) ?? '0') + 1;
          store.set(key, String(next));
          return next;
        }),
        ttl: jest.fn(async () => 120),
        expire: jest.fn(async () => 1),
        del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
        set: jest.fn(async (key: string, value: string) => {
          store.set(key, value);
          return 'OK';
        }),
      };
    }

    function makeService(
      limit: unknown,
      redis: Record<string, jest.Mock> = mockRedis,
    ): AuthService {
      const config = {
        get: jest.fn((key: string) =>
          key === 'AUTH_MAX_NONCE_ATTEMPTS' ? limit : undefined,
        ),
      } as unknown as ConfigService;
      return new AuthService(
        redis as never,
        mockJwtService as unknown as JwtService,
        config,
      );
    }

    afterEach(() => {
      delete process.env.AUTH_MAX_NONCE_ATTEMPTS;
    });

    it('enforces a limit of 2 from ConfigService: the nonce is gone by the third failed attempt', async () => {
      const nonce = 'configured-limit-nonce';
      const { walletAddress } = makeSignedNonce(nonce);
      const redis = makeFakeRedis();
      const nonceKey = `${AuthService.NONCE_PREFIX}${walletAddress}`;
      await redis.set(nonceKey, nonce);
      const limited = makeService('2', redis);
      const attempt = () =>
        limited.verifyWallet({ walletAddress, nonce, signature: badSig });

      // 1st failure: counted, nonce still valid.
      await expect(attempt()).rejects.toThrow('Signature verification failed');
      expect(await redis.get(nonceKey)).toBe(nonce);

      // 2nd failure reaches the configured limit and invalidates the nonce.
      await expect(attempt()).rejects.toThrow(
        'Too many failed attempts; nonce invalidated',
      );
      expect(await redis.get(nonceKey)).toBeNull();

      // 3rd failed attempt is rejected outright — the nonce no longer exists.
      await expect(attempt()).rejects.toThrow(
        'Nonce has expired or does not exist',
      );
    });

    it('ignores process.env and uses the ConfigService value', async () => {
      process.env.AUTH_MAX_NONCE_ATTEMPTS = '1';
      const nonce = 'env-ignored-nonce';
      const { walletAddress } = makeSignedNonce(nonce);

      mockRedis.get.mockResolvedValueOnce(nonce);
      mockRedis.incr.mockResolvedValueOnce(1);

      await expect(
        makeService(undefined).verifyWallet({
          walletAddress,
          nonce,
          signature: badSig,
        }),
      ).rejects.toThrow('Signature verification failed');
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it.each([
      ['absent', undefined],
      ['non-numeric', 'abc'],
      ['zero', '0'],
      ['negative', '-3'],
    ])(
      'falls back to the default of 5 when the value is %s',
      async (_label, value) => {
        expect(AuthService.DEFAULT_MAX_NONCE_ATTEMPTS).toBe(5);
        const nonce = 'fallback-nonce';
        const { walletAddress } = makeSignedNonce(nonce);
        const svc = makeService(value);

        // 4 failures: below the default, nonce survives.
        mockRedis.get.mockResolvedValueOnce(nonce);
        mockRedis.incr.mockResolvedValueOnce(4);
        await expect(
          svc.verifyWallet({ walletAddress, nonce, signature: badSig }),
        ).rejects.toThrow('Signature verification failed');
        expect(mockRedis.del).not.toHaveBeenCalled();

        // 5th failure: default limit reached, nonce invalidated.
        mockRedis.get.mockResolvedValueOnce(nonce);
        mockRedis.incr.mockResolvedValueOnce(5);
        await expect(
          svc.verifyWallet({ walletAddress, nonce, signature: badSig }),
        ).rejects.toThrow('Too many failed attempts; nonce invalidated');
        expect(mockRedis.del).toHaveBeenCalledWith(
          `${AuthService.NONCE_PREFIX}${walletAddress}`,
        );
      },
    );
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

  // ── #412: issuer and audience in issued JWTs ───────────────────────────────

  describe('issueJwt — issuer and audience claims', () => {
    async function signIn(configOverrides: Record<string, string | undefined>) {
      mockConfigService.get.mockImplementation(
        (key: string) => configOverrides[key],
      );

      const nonce = 'iss-aud-nonce';
      const { walletAddress, signature } = makeSignedNonce(nonce);
      mockRedis.get.mockResolvedValueOnce(nonce);
      mockRedis.del.mockResolvedValueOnce(1);

      await service.verifyWallet({ walletAddress, nonce, signature });
    }

    it('includes issuer in sign options when JWT_ISSUER is configured', async () => {
      await signIn({
        JWT_EXPIRES_IN: '15m',
        JWT_ISSUER: 'swyft-api',
        JWT_AUDIENCE: undefined,
      });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ issuer: 'swyft-api' }),
      );
    });

    it('includes audience in sign options when JWT_AUDIENCE is configured', async () => {
      await signIn({
        JWT_EXPIRES_IN: '15m',
        JWT_ISSUER: undefined,
        JWT_AUDIENCE: 'swyft-client',
      });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ audience: 'swyft-client' }),
      );
    });

    it('includes both issuer and audience when both are configured', async () => {
      await signIn({
        JWT_EXPIRES_IN: '15m',
        JWT_ISSUER: 'swyft-api',
        JWT_AUDIENCE: 'swyft-client',
      });

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          issuer: 'swyft-api',
          audience: 'swyft-client',
        }),
      );
    });

    it('omits issuer and audience from sign options when neither is configured', async () => {
      await signIn({
        JWT_EXPIRES_IN: '15m',
        JWT_ISSUER: undefined,
        JWT_AUDIENCE: undefined,
      });

      const signCallOptions = mockJwtService.sign.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(signCallOptions).not.toHaveProperty('issuer');
      expect(signCallOptions).not.toHaveProperty('audience');
    });
  });
});
