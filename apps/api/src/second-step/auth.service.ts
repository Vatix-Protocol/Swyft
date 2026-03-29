import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Redis key prefix used when storing nonces — must match the nonce endpoint. */
  static readonly NONCE_PREFIX = 'auth:nonce:';

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
   *  1. Load the stored nonce from Redis.
   *  2. Validate that the submitted nonce matches the stored one.
   *  3. Verify the Ed25519 signature via the Stellar SDK.
   *  4. Atomically delete the nonce so it cannot be reused.
   *  5. Sign and return a JWT.
   */
  async verifyWallet(dto: VerifyWalletDto): Promise<VerifyResponse> {
    const { walletAddress, nonce, signature } = dto;

    // ── 1. Retrieve stored nonce ──────────────────────────────────────────────
    const redisKey = AuthService.NONCE_PREFIX + walletAddress;
    const storedNonce = await this.redis.get(redisKey);

    if (!storedNonce) {
      this.logger.warn(
        `Nonce lookup failed for wallet ${walletAddress} — expired or never issued`,
      );
      throw new UnauthorizedException('Nonce has expired or does not exist');
    }

    // ── 2. Nonce value match ──────────────────────────────────────────────────
    if (storedNonce !== nonce) {
      this.logger.warn(`Nonce mismatch for wallet ${walletAddress}`);
      // Treat as a 401 rather than 400 — the nonce is present but wrong.
      throw new UnauthorizedException('Nonce mismatch');
    }

    // ── 3. Stellar signature verification ────────────────────────────────────
    this.assertSignatureValid(walletAddress, nonce, signature);

    // ── 4. Consume the nonce (single-use guarantee) ───────────────────────────
    await this.redis.del(redisKey);
    this.logger.log(`Nonce consumed for wallet ${walletAddress}`);

    // ── 5. Issue JWT ──────────────────────────────────────────────────────────
    const accessToken = this.issueJwt(walletAddress);

    return { accessToken };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

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
  ): void {
    let keypair: StellarSdk.Keypair;

    try {
      keypair = StellarSdk.Keypair.fromPublicKey(walletAddress);
    } catch {
      // The DTO regex guards against this, but be defensive.
      throw new BadRequestException(
        `walletAddress '${walletAddress}' is not a valid Stellar public key`,
      );
    }

    let signatureBytes: Buffer;
    try {
      signatureBytes = Buffer.from(signatureB64, 'base64');
      if (signatureBytes.length !== 64) {
        throw new Error('Decoded signature length is not 64 bytes');
      }
    } catch {
      throw new UnauthorizedException(
        'Signature is not valid base64 or has an unexpected length',
      );
    }

    const messageBytes = Buffer.from(nonce, 'utf8');
    const isValid = keypair.verify(messageBytes, signatureBytes);

    if (!isValid) {
      this.logger.warn(
        `Signature verification failed for wallet ${walletAddress}`,
      );
      throw new UnauthorizedException('Signature is invalid');
    }
  }

  /** Signs a JWT payload with the configured secret and expiry. */
  private issueJwt(walletAddress: string): string {
    const payload: JwtPayload = { sub: walletAddress, walletAddress };

    // expiresIn is read from JWT_EXPIRES_IN env; falls back to '15m' if unset.
    const expiresIn =
      this.configService.get<string>('JWT_EXPIRES_IN') ?? '15m';

    return this.jwtService.sign(payload, { expiresIn });
  }
}
