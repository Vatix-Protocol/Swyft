export interface SubmitTransactionDto {
  xdr: string;
}

export interface TransactionResult {
  hash: string;
  ledger: number;
  successful: boolean;
}
