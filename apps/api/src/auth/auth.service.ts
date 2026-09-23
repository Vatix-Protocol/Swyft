import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import * as StellarSdk from '@stellar/stellar-sdk';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { VerifyWalletDto } from './dto/verify-wallet.dto';

/** Shape of the JWT payload stored inside every access token. */
export interface JwtPayload {
  /** Subject — the Stellar wallet address. */
  sub: string;
  walletAddress: string;
  /** Standard issued-at claim (seconds). Populated automatically by JwtService. */
  iat?: number;
  /** Standard expiry claim (seconds). Populated automatically by JwtService. */
  exp?: number;
}

/** Shape returned to the caller on successful verification. */
export interface VerifyResponse {
  accessToken: string;
}

/**
 * Stable, machine-readable error codes for wallet nonce auth failures.
 * Clients should branch on these codes rather than on human-readable messages.
 */
export enum AuthErrorCode {
  NONCE_UNKNOWN = 'AUTH_NONCE_UNKNOWN',
  NONCE_EXPIRED = 'AUTH_NONCE_EXPIRED',
  NONCE_ALREADY_USED = 'AUTH_NONCE_ALREADY_USED',
  NONCE_MISMATCH = 'AUTH_NONCE_MISMATCH',
  SIGNATURE_INVALID = 'AUTH_SIGNATURE_INVALID',
  WALLET_INVALID = 'AUTH_WALLET_INVALID',
  STORE_UNAVAILABLE = 'AUTH_STORE_UNAVAILABLE',
}

/**
 * Lua script that atomically consumes a nonce only when the stored value
 * matches the expected value. Returns 1 when consumed, 0 when the stored
 * value is absent or does not match. This closes the check-then-delete race
 * that would otherwise allow concurrent replay of the same nonce.
 */
const CONSUME_NONCE_LUA = `
local stored = redis.call('GET', KEYS[1])
if not stored then
  return 0
end
if stored ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[1])
return 1
`;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Redis key prefix used when storing nonces — must match the nonce endpoint. */
  static readonly NONCE_PREFIX = 'auth:nonce:';
  /** Redis key prefix for the per-nonce failed-attempt counter. */
  static readonly ATTEMPTS_PREFIX = 'auth:nonce:attempts:';
  /** Failed signature/mismatch attempts allowed against a single nonce before it is invalidated. */
  static readonly MAX_NONCE_ATTEMPTS = Number(
    process.env.AUTH_MAX_NONCE_ATTEMPTS ?? '5',
  );

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Verifies a Freighter-signed nonce and, on success, issues a JWT.
   *
   * Flow:
   *  1. Load the stored nonce from Redis (fail-closed on store outage).
   *  2. Validate that the submitted nonce matches the stored one.
   *  3. Verify the Ed25519 signature via the Stellar SDK.
   *  4. Atomically consume the nonce so it cannot be reused (single-use).
   *  5. Sign and return a JWT.
   *
   * The nonce is only consumed after the signature is verified, and the
   * consume step is atomic, so concurrent or replayed requests cannot both
   * succeed with the same nonce.
   */
  async verifyWallet(dto: VerifyWalletDto): Promise<VerifyResponse> {
    const { walletAddress, nonce, signature } = dto;
    const correlationId = this.newCorrelationId();

    // ── 1. Retrieve stored nonce (fail-closed on store outage) ────────────────
    const redisKey = AuthService.NONCE_PREFIX + walletAddress;
    let storedNonce: string | null;
    try {
      storedNonce = await this.redis.get(redisKey);
    } catch (err) {
      this.logger.error(
        `Nonce store unavailable during lookup for wallet ${walletAddress} [cid=${correlationId}]: ${(err as Error).message}`,
      );
      throw this.storeUnavailable(correlationId);
    }

    if (!storedNonce) {
      this.logger.warn(
        `Nonce lookup failed for wallet ${walletAddress} — expired or never issued [cid=${correlationId}]`,
      );
      throw this.unauthorized(
        AuthErrorCode.NONCE_UNKNOWN,
        'Nonce has expired or does not exist',
        correlationId,
      );
    }

    // ── 2. Nonce value match ──────────────────────────────────────────────────
    if (storedNonce !== nonce) {
      await this.registerFailedAttempt(walletAddress, redisKey);
      this.logger.warn(
        `Nonce mismatch for wallet ${walletAddress} [cid=${correlationId}]`,
      );
      // Treat as a 401 rather than 400 — the nonce is present but wrong.
      throw this.unauthorized(
        AuthErrorCode.NONCE_MISMATCH,
        'Nonce mismatch',
        correlationId,
      );
    }

    // ── 3. Stellar signature verification ────────────────────────────────────
    try {
      this.assertSignatureValid(walletAddress, nonce, signature, correlationId);
    } catch (err) {
      await this.registerFailedAttempt(walletAddress, redisKey);
      throw err;
    }

    // ── 4. Atomically consume the nonce (single-use guarantee) ────────────────
    // The Lua script deletes the key only if it still holds the expected
    // nonce, so a concurrent request that already consumed it will observe a
    // 0 result and be rejected as a replay.
    let consumed: unknown;
    try {
      consumed = await this.redis.eval(
        CONSUME_NONCE_LUA,
        1,
        redisKey,
        nonce,
      );
    } catch (err) {
      this.logger.error(
        `Nonce store unavailable during consume for wallet ${walletAddress} [cid=${correlationId}]: ${(err as Error).message}`,
      );
      throw this.storeUnavailable(correlationId);
    }

    if (Number(consumed) !== 1) {
      this.logger.warn(
        `Nonce replay/concurrent reuse rejected for wallet ${walletAddress} [cid=${correlationId}]`,
      );
      throw this.unauthorized(
        AuthErrorCode.NONCE_ALREADY_USED,
        'Nonce has already been used',
        correlationId,
      );
    }

    await this.redis.del(AuthService.ATTEMPTS_PREFIX + walletAddress);
    this.logger.log(
      `Nonce consumed for wallet ${walletAddress} [cid=${correlationId}]`,
    );

    // ── 5. Issue JWT ──────────────────────────────────────────────────────────
    const accessToken = this.issueJwt(walletAddress);

    return { accessToken };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** Generates a short correlation id for tracing a single auth attempt. */
  private newCorrelationId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  /** Builds a 401 with a stable error code and correlation id. */
  private unauthorized(
    code: AuthErrorCode,
    message: string,
    correlationId: string,
  ): UnauthorizedException {
    return new UnauthorizedException({
      code,
      message,
      correlationId,
    });
  }

  /** Builds a fail-closed 503 when the nonce store cannot be reached. */
  private storeUnavailable(correlationId: string): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: AuthErrorCode.STORE_UNAVAILABLE,
      message: 'Authentication temporarily unavailable',
      correlationId,
    });
  }

  /**
   * Increments the failed-attempt counter for a nonce and invalidates the
   * nonce once `MAX_NONCE_ATTEMPTS` is reached, preventing an attacker from
   * hammering /auth/verify with bad signatures for the remainder of the
   * nonce's TTL.
   */
  private async registerFailedAttempt(
    walletAddress: string,
    nonceKey: string,
  ): Promise<void> {
    const attemptsKey = AuthService.ATTEMPTS_PREFIX + walletAddress;
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) {
      const nonceTtl = await this.redis.ttl(nonceKey);
      await this.redis.expire(attemptsKey, nonceTtl > 0 ? nonceTtl : 120);
    }

    if (attempts >= AuthService.MAX_NONCE_ATTEMPTS) {
      await this.redis.del(nonceKey);
      await this.redis.del(attemptsKey);
      this.logger.warn(
        `Nonce invalidated for wallet ${walletAddress} after ${attempts} failed attempts`,
      );
      throw new UnauthorizedException(
        'Too many failed attempts; nonce invalidated',
      );
    }
  }

  /**
   * Verifies an Ed25519 signature produced by Freighter.
   *
   * Freighter signs the raw UTF-8 bytes of the nonce string with the wallet's
   * secret key.  The resulting 64-byte signature is base64-encoded before
   * transmission.
   *
   * Throws `UnauthorizedException` if the signature is invalid or if the
   * public key cannot be parsed (malformed address that slipped past the DTO
   * regex).
   */
  private assertSignatureValid(
    walletAddress: string,
    nonce: string,
    signatureB64: string,
    correlationId: string,
  ): void {
    let keypair: StellarSdk.Keypair;

    try {
      keypair = StellarSdk.Keypair.fromPublicKey(walletAddress);
    } catch {
      // The DTO regex guards against this, but be defensive.
      throw new BadRequestException({
        code: AuthErrorCode.WALLET_INVALID,
        message: `walletAddress '${walletAddress}' is not a valid Stellar public key`,
        correlationId,
      });
    }

    let signatureBytes: Buffer;
    try {
      signatureBytes = Buffer.from(signatureB64, 'base64');
      if (signatureBytes.length !== 64) {
        throw new Error('Decoded signature length is not 64 bytes');
      }
    } catch {
      throw this.unauthorized(
        AuthErrorCode.SIGNATURE_INVALID,
        'Signature is malformed',
        correlationId,
      );
    }

    const messageBytes = Buffer.from(nonce, 'utf8');
    const valid = keypair.verify(messageBytes, signatureBytes);

    if (!valid) {
      this.logger.warn(
        `Signature verification failed for wallet ${walletAddress} [cid=${correlationId}]`,
      );
      throw this.unauthorized(
        AuthErrorCode.SIGNATURE_INVALID,
        'Signature verification failed',
        correlationId,
      );
    }
  }

  /** Signs a JWT for the verified wallet address. */
  private issueJwt(walletAddress: string): string {
    const payload: JwtPayload = {
      sub: walletAddress,
      walletAddress,
    };

    return this.jwtService.sign(payload);
  }
}
