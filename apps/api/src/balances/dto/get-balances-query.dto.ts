import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { StrKey } from '@stellar/stellar-sdk';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateBy,
} from 'class-validator';

/**
 * Position NFT metadata standards (issue #1020).
 *
 * The `metadata` view of a wallet's balances exposes the position NFT
 * metadata surface. Per `CONTRACTS.md`, position NFT metadata is a
 * read-only projection: the server/contract remains the source of truth
 * for balances, swaps, and admin. This DTO validates bounded, allow-listed
 * request values before any RPC/DB/Redis call is attempted.
 *
 * Invariants enforced here (fail-closed, deny-by-default):
 * - `address` is required and must match Stellar's 56-character account-key
 *   shape; missing, blank, or malformed input is rejected before downstream
 *   work is attempted.
 * - `view` defaults to `balances`; only the explicitly allow-listed
 *   `balances` and `metadata` views are accepted, so untrusted clients
 *   cannot request arbitrary projections.
 * - `correlationId` is optional and, when supplied, is echoed back in
 *   responses/logs for tracing without leaking secrets.
 */
export const POSITION_NFT_METADATA_VIEW = 'metadata' as const;
export const BALANCES_VIEW = 'balances' as const;
export type BalancesView =
  typeof BALANCES_VIEW | typeof POSITION_NFT_METADATA_VIEW;

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

const IsStellarAccountAddress = ValidateBy({
  name: 'isStellarAccountAddress',
  validator: {
    validate: (value: unknown) =>
      typeof value === 'string' && StrKey.isValidEd25519PublicKey(value),
    defaultMessage: () =>
      'address must be a valid Stellar wallet address (G...)',
  },
});

export class GetBalancesQueryDto {
  @ApiProperty({
    description: 'Wallet (Ed25519 public) address to fetch token balances for',
    example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
    minLength: 56,
    maxLength: 56,
    pattern: '^G[A-Z2-7]{55}$',
  })
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'address must be a string' })
  @IsNotEmpty({ message: 'address is required' })
  @IsStellarAccountAddress
  address!: string;

  @ApiPropertyOptional({
    description:
      'Projection to return. `balances` (default) returns fungible token ' +
      'balances; `metadata` returns position NFT metadata per CONTRACTS.md.',
    enum: [BALANCES_VIEW, POSITION_NFT_METADATA_VIEW],
    default: BALANCES_VIEW,
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
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
    maxLength: 128,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'correlationId must be a string' })
  @IsNotEmpty({ message: 'correlationId must not be empty when provided' })
  @MaxLength(128, {
    message: 'correlationId must not be longer than 128 characters',
  })
  @Matches(CORRELATION_ID_PATTERN, {
    message:
      'correlationId may contain only letters, numbers, periods, underscores, colons, and hyphens',
  })
  correlationId?: string;
}
