import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SWAGGER_TAGS } from '../swagger.constants';
import { TransactionsService } from './transactions.service';
import { SubmitTransactionDto, TransactionResult } from './transactions.types';

@ApiTags(SWAGGER_TAGS.TRANSACTIONS)
@ApiBearerAuth()
@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a signed XDR transaction to Stellar' })
  @ApiBody({ type: SubmitTransactionDto })
  @ApiResponse({
    status: 200,
    description: 'Transaction accepted and included in a ledger',
    type: TransactionResult,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or malformed XDR',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — valid JWT required',
  })
  @ApiResponse({
    status: 422,
    description: 'Transaction rejected by Stellar (slippage, expiry, Horizon unreachable)',
  })
  submit(@Body() body: SubmitTransactionDto): Promise<TransactionResult> {
    return this.service.submit(body.xdr);
  }
}
