import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Position NFT metadata standards (issue #1020).
 *
 * The `metadata` view of a wallet's balances exposes the position NFT
 * metadata surface. Per `CONTRACTS.md`, position NFT metadata is a
 * read-only projection: the server/contract remains the source of truth
 * for balances, swaps, and admin. This DTO only validates the *shape* of
 * the request; the precise Stellar address format (`G` + 55 base32 chars)
 * is checked in `BalancesService`, mirroring how `TransactionsService`
 * validates XDR shape beyond what the DTO can express.
 *
 * Invariants enforced here (fail-closed, deny-by-default):
 * - `address` is required and non-empty; missing/blank input is rejected
 *   before any RPC/DB/Redis call is attempted.
 * - `view` defaults to `balances`; only the explicitly allow-listed
 *   `balances` and `metadata` views are accepted, so untrusted clients
 *   cannot request arbitrary projections.
 * - `correlationId` is optional and, when supplied, is echoed back in
 *   responses/logs for tracing without leaking secrets.
 */
export const POSITION_NFT_METADATA_VIEW = 'metadata' as const;
export const BALANCES_VIEW = 'balances' as const;
export type BalancesView =
  | typeof BALANCES_VIEW
  | typeof POSITION_NFT_METADATA_VIEW;

export class GetBalancesQueryDto {
  @ApiProperty({
    description: 'Wallet (Ed25519 public) address to fetch token balances for',
    example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
  })
  @IsString({ message: 'address must be a string' })
  @IsNotEmpty({ message: 'address is required' })
  address!: string;

  @ApiPropertyOptional({
    description:
      'Projection to return. `balances` (default) returns fungible token ' +
      'balances; `metadata` returns position NFT metadata per CONTRACTS.md.',
    enum: [BALANCES_VIEW, POSITION_NFT_METADATA_VIEW],
    default: BALANCES_VIEW,
  })
  @IsOptional()
  @IsString({ message: 'view must be a string' })
  @IsIn([BALANCES_VIEW, POSITION_NFT_METADATA_VIEW], {
    message: 'view must be one of: balances, metadata',
  })
  view?: BalancesView;

  @ApiPropertyOptional({
    description:
      'Optional client-supplied correlation id echoed in responses and logs ' +
      'for tracing. Must not contain secrets.',
    example: 'req-7f3c1a2b',
  })
  @IsOptional()
  @IsString({ message: 'correlationId must be a string' })
  @IsNotEmpty({ message: 'correlationId must not be empty when provided' })
  correlationId?: string;
}
