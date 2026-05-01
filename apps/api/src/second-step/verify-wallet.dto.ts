import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyWalletDto {
  /**
   * Stellar G-address (56-char base32).
   * Validated structurally here; cryptographic validity is checked during
   * Keypair.fromPublicKey inside the service.
   */
  @IsString()
  @IsNotEmpty({ message: 'walletAddress must not be empty' })
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'walletAddress must be a valid Stellar public key (G…)',
  })
  walletAddress: string;

  /** The plain-text nonce string originally issued by POST /auth/nonce. */
  @IsString()
  @IsNotEmpty({ message: 'nonce must not be empty' })
  nonce: string;

  /** Base64-encoded Ed25519 signature produced by Freighter over the nonce. */
  @IsString()
  @IsNotEmpty({ message: 'signature must not be empty' })
  signature: string;
}
