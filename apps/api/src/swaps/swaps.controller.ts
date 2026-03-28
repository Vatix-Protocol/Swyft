import { Controller, Get, Query } from '@nestjs/common';
import { GetSwapsQueryDto } from './dto/get-swaps-query.dto';
import { SwapsListResponse, SwapsService } from './swaps.service';

@Controller('swaps')
export class SwapsController {
  constructor(private readonly swapsService: SwapsService) {}

  @Get()
  getSwaps(@Query() query: GetSwapsQueryDto): Promise<SwapsListResponse> {
    return this.swapsService.getSwaps(query);
  }
}
