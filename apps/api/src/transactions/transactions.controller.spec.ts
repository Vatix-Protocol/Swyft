import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import {
  InvalidInputException,
  BusinessRuleViolationException,
} from '../request-validation/http.exceptions';

const VALID_XDR = 'AAAAAgAAAAB...base64xdr...';
const TX_HASH = 'abc123deadbeef';

describe('TransactionsController', () => {
  let controller: TransactionsController;
  let service: jest.Mocked<TransactionsService>;

  beforeEach(async () => {
    const mockTransactionsService = {
      submit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        { provide: TransactionsService, useValue: mockTransactionsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TransactionsController>(TransactionsController);
    service = module.get(TransactionsService);
  });

  describe('submit()', () => {
    it('returns transaction result on success', async () => {
      const expectedResult = { hash: TX_HASH, ledger: 100, successful: true };
      service.submit.mockResolvedValue(expectedResult);

      const result = await controller.submit({ xdr: VALID_XDR });

      expect(result).toEqual(expectedResult);
      expect(service.submit).toHaveBeenCalledWith(VALID_XDR);
    });

    it('propagates InvalidInputException (BadRequestException)', async () => {
      service.submit.mockRejectedValue(new InvalidInputException('bad XDR'));

      await expect(controller.submit({ xdr: VALID_XDR })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('propagates BusinessRuleViolationException (UnprocessableEntityException)', async () => {
      service.submit.mockRejectedValue(
        new BusinessRuleViolationException('slippage'),
      );

      await expect(controller.submit({ xdr: VALID_XDR })).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });
});
