import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitTransactionDto {
  @ApiProperty({ description: 'Base64-encoded XDR of a signed Stellar transaction' })
  @IsString()
  @IsNotEmpty()
  xdr: string;
}

export interface TransactionResult {
  hash: string;
  ledger: number;
  successful: boolean;
}
