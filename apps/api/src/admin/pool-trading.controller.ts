import {
  BadRequestException,
  Body,
  Controller,
  Patch,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InternalKeyGuard } from './internal-key.guard';
import { PoolTradingService, PoolTradingState } from './pool-trading.service';

interface PoolTradingPatch {
  paused: boolean;
}

@ApiTags('admin')
@Controller('admin/pools')
@UseGuards(InternalKeyGuard)
export class PoolTradingController {
  constructor(private readonly poolTradingService: PoolTradingService) {}

  @Patch(':poolId/trading')
  @ApiOperation({
    summary: 'Pause or resume trading for a pool',
    description:
      'Changes the pool activity flag used by trading and liquidity paths. Requires the internal admin key.',
  })
  @ApiParam({ name: 'poolId', description: 'Pool identifier' })
  @ApiResponse({ status: 200, description: 'Trading state updated' })
  @ApiResponse({ status: 400, description: 'paused must be a boolean' })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  async setTradingState(
    @Param('poolId') poolId: string,
    @Body() body: PoolTradingPatch,
  ): Promise<PoolTradingState> {
    if (typeof body?.paused !== 'boolean') {
      throw new BadRequestException('paused must be a boolean');
    }
    return this.poolTradingService.setPaused(poolId, body.paused);
  }
}
