import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentWallet } from '../auth/current-wallet.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetPositionsQueryDto } from './dto/get-positions-query.dto';
import { PositionsListResponse, PositionsService } from './positions.service';

@Controller('positions')
@UseGuards(JwtAuthGuard)
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Get()
  getPositions(
    @CurrentWallet() walletAddress: string,
    @Query() query: GetPositionsQueryDto,
  ): Promise<PositionsListResponse> {
    return this.positionsService.getPositions(walletAddress, query);
  }
}
