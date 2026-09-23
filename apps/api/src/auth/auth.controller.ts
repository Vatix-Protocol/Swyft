import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AuthService, VerifyResponse } from './auth.service';
import { VerifyWalletDto } from './dto/verify-wallet.dto';
import { SWAGGER_TAGS } from '../swagger.constants';

/**
 * Header carrying a client-supplied correlation id. When absent the server
 * generates one so every verify-wallet attempt is traceable end-to-end.
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Stable, machine-readable error codes returned by the verify-wallet surface.
 * Clients must branch on these codes rather than on HTTP status text.
 */
export const VERIFY_WALLET_ERROR_CODES = {
  INVALID_REQUEST: 'AUTH_INVALID_REQUEST',
  NONCE_EXPIRED: 'AUTH_NONCE_EXPIRED',
  NONCE_REPLAYED: 'AUTH_NONCE_REPLAYED',
  SIGNATURE_INVALID: 'AUTH_SIGNATURE_INVALID',
  WALLET_MISMATCH: 'AUTH_WALLET_MISMATCH',
  DEPENDENCY_UNAVAILABLE: 'AUTH_DEPENDENCY_UNAVAILABLE',
} as const;

export type VerifyWalletErrorCode =
  (typeof VERIFY_WALLET_ERROR_CODES)[keyof typeof VERIFY_WALLET_ERROR_CODES];

@ApiTags(SWAGGER_TAGS.AUTH)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Step 2 of wallet-based auth.
   *
   * Accepts the Stellar wallet address, the nonce originally issued by
   * `POST /auth/nonce`, and the Freighter/xBull-produced base64 signature.
   * On success returns a short-lived JWT.
   *
   * The nonce is single-use: the service consumes it atomically before
   * verifying the signature, so replayed or expired nonces fail closed.
   * A correlation id is echoed back (or generated) for observability.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a Stellar wallet signature and receive a JWT',
  })
  @ApiHeader({
    name: CORRELATION_ID_HEADER,
    required: false,
    description:
      'Optional client correlation id; echoed back and used for tracing. Generated when omitted.',
  })
  @ApiBody({ type: VerifyWalletDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signature verified — JWT issued',
    schema: {
      example: {
        accessToken:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJHQUJDREVGLi4uIiwid2FsbGV0QWRkcmVzcyI6IkdBQkNERUYuLi4iLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTYwMDAwMDkwMH0.signature',
        correlationId: 'b3f1c2e4-9a7d-4c1e-8f2a-1d2e3f4a5b6c',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Missing or malformed request body fields (AUTH_INVALID_REQUEST)',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description:
      'Nonce expired/replayed, wallet mismatch, or signature invalid (AUTH_NONCE_EXPIRED, AUTH_NONCE_REPLAYED, AUTH_WALLET_MISMATCH, AUTH_SIGNATURE_INVALID)',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Nonce store / RPC unavailable — fail-closed (AUTH_DEPENDENCY_UNAVAILABLE)',
  })
  async verifyWallet(
    @Body() dto: VerifyWalletDto,
    @Headers(CORRELATION_ID_HEADER) correlationIdHeader?: string,
    @Req() req?: Request,
  ): Promise<VerifyResponse> {
    const correlationId = this.resolveCorrelationId(correlationIdHeader, req);
    return this.authService.verifyWallet(dto, correlationId);
  }

  /**
   * Prefer the client-supplied correlation id when it is a sane, bounded
   * string; otherwise generate a fresh one. Never trust unbounded input.
   */
  private resolveCorrelationId(
    header: string | undefined,
    req?: Request,
  ): string {
    const candidate = (header ?? '').trim();
    if (candidate.length > 0 && candidate.length <= 128 && /^[\w.\-:]+$/.test(candidate)) {
      return candidate;
    }
    const existing = (req?.headers?.[CORRELATION_ID_HEADER] as string | undefined)?.trim();
    if (existing && existing.length <= 128 && /^[\w.\-:]+$/.test(existing)) {
      return existing;
    }
    return randomCorrelationId();
  }
}

function randomCorrelationId(): string {
  // Node 18+ exposes globalThis.crypto.randomUUID; fall back defensively.
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
