import { IsOptional, IsString, Matches } from 'class-validator';

export class NonceDto {
  /**
   * Stellar G-address (56-char base32). Validated structurally here to match
   * the check already enforced in VerifyWalletDto for /auth/verify.
   * Optional so an empty/missing body still gets the controller's helpful
   * "how to start auth" message rather than a validation error.
   */
  @IsOptional()
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'walletAddress must be a valid Stellar public key (G…)',
  })
  walletAddress?: string;
}
