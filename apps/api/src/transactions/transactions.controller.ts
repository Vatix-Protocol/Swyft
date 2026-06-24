import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SWAGGER_TAGS } from '../swagger.constants';
import { TransactionsService } from './transactions.service';
import { SubmitTransactionDto, TransactionResult } from './transactions.types';

@ApiTags(SWAGGER_TAGS.TRANSACTIONS)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a signed XDR transaction to Stellar' })
  submit(@Body() body: SubmitTransactionDto): Promise<TransactionResult> {
    return this.service.submit(body.xdr);
  }
}
