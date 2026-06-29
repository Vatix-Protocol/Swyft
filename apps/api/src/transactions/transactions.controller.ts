import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SWAGGER_TAGS } from '../swagger.constants';
import { TransactionsService } from './transactions.service';
import { SubmitTransactionDto, TransactionResult } from './transactions.types';

@ApiTags(SWAGGER_TAGS.TRANSACTIONS)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a signed XDR transaction to Stellar' })
  @ApiResponse({
    status: 201,
    description: 'Transaction accepted — returns hash and ledger sequence.',
    schema: {
      properties: {
        hash: { type: 'string', example: 'abc123...' },
        ledger: { type: 'number', example: 54321 },
        successful: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or malformed XDR.' })
  @ApiResponse({ status: 422, description: 'Transaction rejected by Horizon.' })
  submit(@Body() body: SubmitTransactionDto): Promise<TransactionResult> {
    return this.service.submit(body.xdr);
  }
}
