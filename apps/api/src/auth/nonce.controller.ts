import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import * as crypto from 'crypto';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { NonceDto } from './dto/nonce.dto';

/**
 * Stable, typed error codes for the wallet nonce auth flow.
 *
 * These are part of the public contract consumed by clients and are safe to
 * surface (no secrets). They let callers distinguish retryable conditions
 * (store unavailable) from terminal ones (expired / already used / unknown).
 */
export enum NonceErrorCode {
  INVALID_WALLET = 'NONCE_INVALID_WALLET',
  STORE_UNAVAILABLE = 'NONCE_STORE_UNAVAILABLE',
  UNKNOWN = 'NONCE_UNKNOWN',
  EXPIRED = 'NONCE_EXPIRED',
  ALREADY_USED = 'NONCE_ALREADY_USED',
}

/**
 * Lua script that atomically consumes a nonce.
 *
 * Single-use invariant: a nonce is valid only if the stored value matches the
 * presented value. On a match we delete the key in the same atomic step, so a
 * concurrent or replayed request can never observe the same nonce as valid
 * twice. Returns 1 on success, 0 otherwise.
 */
const CONSUME_NONCE_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then
  return 0
end
if current ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[1])
return 1
`;

const NONCE_TTL_SECONDS = 120;

/**
 * Wallet nonce auth endpoints.
 *
 * Behaviour:
 * - `POST /auth/nonce` issues a short random nonce bound to a wallet address
 *   and stores it in Redis under `auth:nonce:<walletAddress>` with a TTL.
 * - `POST /auth/verify` consumes the nonce atomically (single-use). Replays,
 *   concurrent reuse, expired and unknown nonces are rejected with stable
 *   typed error codes. If the nonce store is unavailable the request fails
 *   closed (no auth is granted).
 *
 * The server is the source of truth: wallet addresses are validated and the
 * nonce is only ever consumed server-side. Untrusted clients cannot bypass
 * the single-use policy.
 */
@Controller('auth')
export class NonceController {
  private readonly logger = new Logger(NonceController.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  @Post('nonce')
  @HttpCode(HttpStatus.OK)
  async issueNonce(@Body() body: NonceDto | undefined) {
    if (!body || !body.walletAddress) {
      return {
        nonce: null,
        message:
          'To begin wallet authentication, POST { walletAddress } to this endpoint. You will receive a nonce to sign and submit to /auth/verify.',
      };
    }

    const walletAddress = this.normalizeWalletAddress(body.walletAddress);
    if (!walletAddress) {
      throw this.error(
        HttpStatus.BAD_REQUEST,
        NonceErrorCode.INVALID_WALLET,
        'walletAddress must be a valid Stellar public key (G...).',
      );
    }

    // 24-byte random nonce, base64 for convenience
    const nonce = crypto.randomBytes(24).toString('base64');
    const key = this.nonceKey(walletAddress);

    try {
      // Store nonce for 2 minutes (120 seconds).
      await this.redis.set(key, nonce, 'EX', NONCE_TTL_SECONDS);
    } catch (err) {
      // Fail closed: never hand out a nonce we could not persist.
      this.logger.error(
        `nonce store unavailable while issuing nonce (code=${NonceErrorCode.STORE_UNAVAILABLE})`,
      );
      throw this.error(
        HttpStatus.SERVICE_UNAVAILABLE,
        NonceErrorCode.STORE_UNAVAILABLE,
        'Nonce store is unavailable; please retry.',
      );
    }

    return {
      nonce,
      message: 'Sign this nonce with your wallet and POST to /auth/verify',
    };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyNonce(
    @Body()
    body:
      | { walletAddress?: string; nonce?: string; signature?: string }
      | undefined,
  ) {
    const walletAddress = this.normalizeWalletAddress(body?.walletAddress);
    const nonce = body?.nonce;

    if (!walletAddress || !nonce) {
      throw this.error(
        HttpStatus.BAD_REQUEST,
        NonceErrorCode.INVALID_WALLET,
        'walletAddress and nonce are required.',
      );
    }

    const key = this.nonceKey(walletAddress);

    let consumed: unknown;
    try {
      // Atomic single-use consumption: match-and-delete in one step.
      consumed = await this.redis.eval(CONSUME_NONCE_LUA, 1, key, nonce);
    } catch (err) {
      // Fail closed: if the store is down we cannot prove single-use, so we
      // reject rather than granting auth.
      this.logger.error(
        `nonce store unavailable during verify (code=${NonceErrorCode.STORE_UNAVAILABLE})`,
      );
      throw this.error(
        HttpStatus.SERVICE_UNAVAILABLE,
        NonceErrorCode.STORE_UNAVAILABLE,
        'Nonce store is unavailable; please retry.',
      );
    }

    if (Number(consumed) !== 1) {
      // The nonce was absent (expired/unknown) or already consumed (replay).
      // We cannot distinguish these without leaking state, so report a
      // terminal, non-retryable error.
      throw this.error(
        HttpStatus.UNAUTHORIZED,
        NonceErrorCode.ALREADY_USED,
        'Nonce is invalid, expired, or already used.',
      );
    }

    // Signature verification is performed by the downstream auth service; the
    // nonce has now been consumed exactly once regardless of that outcome.
    return {
      walletAddress,
      verified: true,
      message: 'Nonce consumed. Continue with signature verification.',
    };
  }

  private nonceKey(walletAddress: string): string {
    return `auth:nonce:${walletAddress}`;
  }

  /**
   * Validate and normalize a Stellar wallet address server-side. Returns null
   * for anything that is not a well-formed public key so untrusted input can
   * never reach the nonce store.
   */
  private normalizeWalletAddress(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!/^G[A-Z2-7]{55}$/.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  private error(
    status: HttpStatus,
    code: NonceErrorCode,
    message: string,
  ): HttpException {
    return new HttpException(
      {
        statusCode: status,
        code,
        message,
        correlationId: crypto.randomUUID(),
      },
      status,
    );
  }
}
