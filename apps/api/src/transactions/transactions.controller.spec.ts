// ─── Stellar SDK mock ─────────────────────────────────────────────────────────
// Prevents real network calls and XDR parsing in unit tests.

const mockSendTransaction = jest.fn();
const MockServer = jest.fn().mockImplementation(() => ({
  sendTransaction: mockSendTransaction,
}));

const mockFromXDR = jest.fn();

jest.mock('@stellar/stellar-sdk', () => ({
  SorobanRpc: { Server: MockServer },
  TransactionBuilder: { fromXDR: mockFromXDR },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_XDR = 'AAAAAgAAAAB...base64xdr...';
const TX_HASH = 'abc123deadbeef';

function makePendingResponse() {
  return { status: 'PENDING', hash: TX_HASH };
}

function makeErrorResponse(extra: Record<string, unknown> = {}) {
  return {
    status: 'ERROR',
    hash: TX_HASH,
    errorResult: null,
    ...extra,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TransactionsController', () => {
  let controller: TransactionsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFromXDR.mockReturnValue({} as never);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [TransactionsService],
    }).compile();

    controller = module.get<TransactionsController>(TransactionsController);
  });

  describe('POST /transactions — success', () => {
    it('returns { hash } when the RPC responds with PENDING', async () => {
      mockSendTransaction.mockResolvedValue(makePendingResponse());
      const result = await controller.submit({ xdr: VALID_XDR });
      expect(result).toEqual({ hash: TX_HASH });
    });

    it('returns { hash } when the RPC responds with DUPLICATE', async () => {
      mockSendTransaction.mockResolvedValue({ status: 'DUPLICATE', hash: TX_HASH });
      const result = await controller.submit({ xdr: VALID_XDR });
      expect(result).toEqual({ hash: TX_HASH });
    });

    it('calls sendTransaction with the parsed transaction object', async () => {
      const fakeTx = { type: 'fake-tx' };
      mockFromXDR.mockReturnValue(fakeTx);
      mockSendTransaction.mockResolvedValue(makePendingResponse());
      await controller.submit({ xdr: VALID_XDR });
      expect(mockSendTransaction).toHaveBeenCalledWith(fakeTx);
    });
  });

  describe('POST /transactions — slippage error', () => {
    it('throws UnprocessableEntityException with code SLIPPAGE_EXCEEDED', async () => {
      mockSendTransaction.mockResolvedValue(
        makeErrorResponse({
          errorResult: {
            toXDR: () => 'slippage_error_encoded',
          },
        }),
      );

      await expect(controller.submit({ xdr: VALID_XDR })).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('includes { code: "SLIPPAGE_EXCEEDED" } in the response body', async () => {
      mockSendTransaction.mockResolvedValue(
        makeErrorResponse({
          errorResult: {
            toXDR: () => 'AmountOutMin_not_satisfied',
          },
        }),
      );

      const err = await controller
        .submit({ xdr: VALID_XDR })
        .catch((e: UnprocessableEntityException) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'SLIPPAGE_EXCEEDED',
      });
    });
  });

  describe('POST /transactions — generic error', () => {
    it('throws UnprocessableEntityException with code TRANSACTION_FAILED for non-slippage errors', async () => {
      mockSendTransaction.mockResolvedValue(makeErrorResponse());

      const err = await controller
        .submit({ xdr: VALID_XDR })
        .catch((e: UnprocessableEntityException) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'TRANSACTION_FAILED',
      });
    });
  });

  describe('POST /transactions — invalid XDR', () => {
    it('throws BadRequestException when XDR cannot be parsed', async () => {
      mockFromXDR.mockImplementation(() => {
        throw new Error('Invalid XDR');
      });

      await expect(controller.submit({ xdr: 'bad-xdr' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
