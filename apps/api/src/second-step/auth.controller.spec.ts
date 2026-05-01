import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { VerifyWalletDto } from './dto/verify-wallet.dto';

const mockAuthService = {
  verifyWallet: jest.fn(),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('POST /auth/verify', () => {
    const dto: VerifyWalletDto = {
      walletAddress: 'GABC' + 'D'.repeat(52),
      nonce: 'abc123',
      signature: Buffer.alloc(64).toString('base64'),
    };

    it('delegates to AuthService.verifyWallet and returns the result', async () => {
      const expected = { accessToken: 'mock.jwt.token' };
      mockAuthService.verifyWallet.mockResolvedValueOnce(expected);

      const result = await controller.verifyWallet(dto);

      expect(mockAuthService.verifyWallet).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
    });

    it('propagates UnauthorizedException thrown by the service', async () => {
      mockAuthService.verifyWallet.mockRejectedValueOnce(
        new UnauthorizedException('Nonce has expired or does not exist'),
      );

      await expect(controller.verifyWallet(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
