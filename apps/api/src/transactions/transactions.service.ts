import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvalidInputException,
  BusinessRuleViolationException,
} from '../request-validation/http.exceptions';
import { TransactionResult } from './transactions.types';
import { STELLAR_CONFIG_KEY, StellarConfig } from '../config/stellar.config';

/** Minimum byte length of a valid XDR envelope after base64 decode (~40 bytes for smallest tx). */
const XDR_MIN_DECODED_BYTES = 40;

@Injectable()
export class TransactionsService {
  private readonly horizonUrl: string;

  constructor(private readonly config: ConfigService) {
    const stellarCfg = this.config.get<StellarConfig>(STELLAR_CONFIG_KEY)!;
    this.horizonUrl = stellarCfg.horizonUrl;
  }
  async submit(xdr: string): Promise<TransactionResult> {
    this.validateXdr(xdr);

    const body = new URLSearchParams({ tx: xdr });

    let res: Response;
    try {
      res = await fetch(`${this.horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new BusinessRuleViolationException(
        `Horizon unreachable: ${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as {
        extras?: { result_codes?: { transaction?: string } };
      };
      const code = payload?.extras?.result_codes?.transaction ?? '';

      if (code === 'tx_bad_auth' || code === 'tx_malformed') {
        throw new InvalidInputException(`Transaction rejected: ${code}`);
      }
      if (code === 'tx_too_late' || code === 'tx_too_early') {
        throw new BusinessRuleViolationException(
          `Transaction expired or not yet valid: ${code}`,
        );
      }
      if (code.startsWith('op_')) {
        throw new BusinessRuleViolationException(
          `Operation failed (likely slippage): ${code}`,
        );
      }
      throw new BusinessRuleViolationException(
        `Transaction failed: ${code || res.statusText}`,
      );
    }

    const data = (await res.json()) as {
      hash: string;
      ledger: number;
      successful: boolean;
    };
    return {
      hash: data.hash,
      ledger: data.ledger,
      successful: data.successful,
    };
  }

  /**
   * Validates that the provided string is a non-empty, valid base64-encoded XDR
   * envelope of sufficient length to represent a Stellar transaction.
   * Throws InvalidInputException for any structural problem detected before
   * the network round-trip to Horizon.
   */
  private validateXdr(xdr: string): void {
    if (!xdr || typeof xdr !== 'string') {
      throw new InvalidInputException('XDR is required');
    }

    // Stellar XDR is standard base64 (A-Z a-z 0-9 + / =)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(xdr)) {
      throw new InvalidInputException(
        'XDR must be a valid base64-encoded string',
      );
    }

    // Padding must make the total length a multiple of 4
    if (xdr.length % 4 !== 0) {
      throw new InvalidInputException('XDR has invalid base64 padding');
    }

    // Decoded length must be at least XDR_MIN_DECODED_BYTES
    const decodedLength = Math.floor((xdr.length * 3) / 4);
    if (decodedLength < XDR_MIN_DECODED_BYTES) {
      throw new InvalidInputException(
        `XDR is too short to be a valid Stellar transaction envelope`,
      );
    }
  }
}
