import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import * as crypto from 'crypto';

import { REDIS_CLIENT } from '../redis/redis.constants';

/**
 * Simple nonce issuance endpoint used by the wallet-based auth flow.
 *
 * Behaviour:
 * - If `walletAddress` is provided in the POST body, a short random nonce
 *   is stored in Redis under `auth:nonce:<walletAddress>` and the nonce is
 *   returned in JSON.
 * - If the request body is empty or missing `walletAddress`, the endpoint
 *   returns a helpful JSON message instead of an empty body so the UI does
 *   not break and can display next steps.
 */
@Controller('auth')
export class NonceController {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  @Post('nonce')
  @HttpCode(HttpStatus.OK)
  async issueNonce(@Body() body: { walletAddress?: string } | undefined) {
    if (!body || !body.walletAddress) {
      return {
        nonce: null,
        message:
          'To begin wallet authentication, POST { walletAddress } to this endpoint. You will receive a nonce to sign and submit to /auth/verify.',
      };
    }

    const { walletAddress } = body;

    // 24-byte random nonce, base64 for convenience
    const nonce = crypto.randomBytes(24).toString('base64');
    const key = `auth:nonce:${walletAddress}`;

    // Store nonce for 2 minutes (120 seconds)
    await this.redis.set(key, nonce, 'EX', 120);

    return { nonce, message: 'Sign this nonce with your wallet and POST to /auth/verify' };
  }
}
