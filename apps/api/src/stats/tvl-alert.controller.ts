import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TvlAlertService, TvlAlertThresholdCreate } from './tvl-alert.service';
import { SWAGGER_TAGS } from '../swagger.constants';

interface AuthRequest {
  user: { walletAddress: string };
}

@ApiTags(SWAGGER_TAGS.STATS)
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('stats/tvl-alerts')
export class TvlAlertController {
  constructor(private readonly tvlAlertService: TvlAlertService) {}

  @Post()
  @ApiOperation({ summary: 'Set or update a TVL alert threshold' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['poolId', 'thresholdUsd', 'direction'],
      properties: {
        poolId: { type: 'string', example: 'pool-123' },
        thresholdUsd: { type: 'number', example: 1000000 },
        direction: { type: 'string', enum: ['below', 'above'], example: 'below' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Alert threshold created or updated' })
  async setThreshold(
    @Request() req: AuthRequest,
    @Body() body: TvlAlertThresholdCreate,
  ) {
    return this.tvlAlertService.setThreshold(req.user.walletAddress, body);
  }

  @Get()
  @ApiOperation({ summary: 'List all TVL alert thresholds for the authenticated wallet' })
  async listThresholds(@Request() req: AuthRequest) {
    return this.tvlAlertService.listThresholds(req.user.walletAddress);
  }

  @Post(':id/disable')
  @ApiOperation({ summary: 'Disable a TVL alert threshold' })
  @ApiParam({ name: 'id', description: 'Alert threshold ID' })
  async disableThreshold(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ) {
    await this.tvlAlertService.disableThreshold(id, req.user.walletAddress);
    return { success: true };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a TVL alert threshold' })
  @ApiParam({ name: 'id', description: 'Alert threshold ID' })
  async deleteThreshold(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ) {
    await this.tvlAlertService.deleteThreshold(id, req.user.walletAddress);
    return { success: true };
  }

  @Get('history/:poolId')
  @ApiOperation({ summary: 'Get historical TVL time series for a pool' })
  @ApiParam({ name: 'poolId', description: 'Pool ID' })
  @ApiResponse({
    status: 200,
    description: 'Array of TVL history entries',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date-time' },
          tvlUsd: { type: 'number' },
        },
      },
    },
  })
  async getTvlHistory(
    @Param('poolId') poolId: string,
    @Request() req: AuthRequest,
  ) {
    // Default to last 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    return this.tvlAlertService.getTvlHistory(poolId, startDate, endDate);
  }
}