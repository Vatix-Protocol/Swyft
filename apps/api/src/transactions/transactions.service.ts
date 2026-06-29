import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvalidInputException,
  BusinessRuleViolationException,
} from '../request-validation/http.exceptions';
import { TransactionResult } from './transactions.types';
import { STELLAR_CONFIG_KEY, StellarConfig } from '../config/stellar.config';

@Injectable()
export class TransactionsService {
  private readonly horizonUrl: string;

  constructor(private readonly config: ConfigService) {
    const stellarCfg = this.config.get<StellarConfig>(STELLAR_CONFIG_KEY)!;
    this.horizonUrl = stellarCfg.horizonUrl;
  }
  async submit(xdr: string): Promise<TransactionResult> {
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
}
