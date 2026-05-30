import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentWallet } from '../auth/current-wallet.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetPositionsQueryDto } from './dto/get-positions-query.dto';
import { PositionsListResponse, PositionsService } from './positions.service';
import { SWAGGER_TAGS } from '../swagger.constants';

@ApiTags(SWAGGER_TAGS.POSITIONS)
@ApiBearerAuth()
@Controller('positions')
@UseGuards(JwtAuthGuard)
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Get()
  @ApiOperation({ summary: 'List positions for the authenticated wallet' })
  @ApiResponse({ status: 200, description: 'Paginated list of positions' })
  @ApiResponse({ status: 401, description: 'Unauthorized — valid JWT required' })
  getPositions(
    @CurrentWallet() walletAddress: string,
    @Query() query: GetPositionsQueryDto,
  ): Promise<PositionsListResponse> {
    return this.positionsService.getPositions(walletAddress, query);
  }
}
