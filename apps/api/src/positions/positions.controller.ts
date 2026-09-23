import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentWallet } from '../auth/current-wallet.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BulkPositionsDto } from './dto/bulk-positions.dto';
import { GetLpActivityQueryDto } from './dto/get-lp-activity-query.dto';
import { GetPositionsQueryDto } from './dto/get-positions-query.dto';
import {
  LpActivityListResponse,
  PositionsListResponse,
  PositionsService,
  WalletPositions,
} from './positions.service';
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
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — valid JWT required',
  })
  getPositions(
    @CurrentWallet() walletAddress: string,
    @Query() query: GetPositionsQueryDto,
  ): Promise<PositionsListResponse> {
    return this.positionsService.getPositions(walletAddress, query);
  }

  @Get('activity')
  @ApiOperation({
    summary:
      'List LP activity (mints, burns, fee collections) for the authenticated wallet',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of real, indexed LP activity events',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — valid JWT required',
  })
  getLpActivity(
    @CurrentWallet() walletAddress: string,
    @Query() query: GetLpActivityQueryDto,
  ): Promise<LpActivityListResponse> {
    return this.positionsService.getLpActivity(walletAddress, query);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Fetch positions for multiple wallets at once' })
  @ApiResponse({
    status: 200,
    description:
      'Positions keyed by the requested wallet address. Wallets with no positions still appear with an empty items array.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — valid JWT required',
  })
  getBulkPositions(
    @CurrentWallet() walletAddress: string,
    @Body() body: BulkPositionsDto,
  ): Promise<Record<string, WalletPositions>> {
    const unauthorized = body.wallets.some(
      (wallet) => wallet.toLowerCase() !== walletAddress.toLowerCase(),
    );
    if (unauthorized) {
      throw new ForbiddenException(
        'Can only fetch positions for the authenticated wallet',
      );
    }
    return this.positionsService.getBulkPositions(body.wallets, body.status);
  }
}
