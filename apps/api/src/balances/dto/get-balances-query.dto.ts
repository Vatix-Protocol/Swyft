import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Basic shape validation only (present, non-empty string) — the precise
 * Stellar address format (`G` + 55 base32 chars) is checked in
 * `BalancesService`, mirroring how `TransactionsService` validates XDR
 * shape beyond what the DTO can express.
 */
export class GetBalancesQueryDto {
  @ApiProperty({
    description: 'Wallet (Ed25519 public) address to fetch token balances for',
    example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
  })
  @IsString({ message: 'address must be a string' })
  @IsNotEmpty({ message: 'address is required' })
  address!: string;
}
