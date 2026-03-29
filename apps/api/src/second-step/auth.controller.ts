import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AuthService, VerifyResponse } from './auth.service';
import { VerifyWalletDto } from './dto/verify-wallet.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Step 2 of wallet-based auth.
   *
   * Accepts the Stellar wallet address, the nonce originally issued by
   * `POST /auth/nonce`, and the Freighter-produced base64 signature.
   * On success returns a short-lived JWT.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a Stellar wallet signature and receive a JWT',
  })
  @ApiBody({ type: VerifyWalletDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signature verified — JWT issued',
    schema: {
      example: {
        accessToken:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJHQUJDREVGLi4uIiwid2FsbGV0QWRkcmVzcyI6IkdBQkNERUYuLi4iLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTYwMDAwMDkwMH0.signature',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Missing or malformed request body fields',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Nonce expired / not found, or signature invalid',
  })
  async verifyWallet(@Body() dto: VerifyWalletDto): Promise<VerifyResponse> {
    return this.authService.verifyWallet(dto);
  }
}
