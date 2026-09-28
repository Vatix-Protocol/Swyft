export const WALLET_REJECTION_CODE = 'WALLET_USER_REJECTED';

export class WalletRejectionError extends Error {
  readonly code = WALLET_REJECTION_CODE;

  constructor(message = 'Signature request was rejected in the wallet.') {
    super(message);
    this.name = 'WalletRejectionError';
  }
}

export function isWalletRejection(error: unknown): boolean {
  if (error instanceof WalletRejectionError) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /reject|cancel|denied|declin|user_abort/i.test(message);
}

export const WALLET_REJECTION_MESSAGE =
  'Signature rejected. Nothing was submitted. Review the transaction and try again.';
