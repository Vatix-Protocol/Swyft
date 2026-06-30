import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitTransactionDto {
  @ApiProperty({
    description: 'Base64-encoded XDR of the signed Stellar transaction envelope',
    example: 'AAAAAgAAAAB...',
  })
  @IsString()
  @IsNotEmpty()
  xdr: string;
}

export class TransactionResult {
  @ApiProperty({ description: 'Transaction hash on the Stellar network' })
  hash: string;

  @ApiProperty({ description: 'Ledger sequence number in which the transaction was included' })
  ledger: number;

  @ApiProperty({ description: 'Whether the transaction succeeded on-chain' })
  successful: boolean;
}
