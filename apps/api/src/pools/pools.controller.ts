import {
  Controller,
  Get,
  Param,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { PoolsService } from './pools.service';
import { CacheService } from '../cache/cache.service';

@ApiTags('pools')
@Controller('pools')
export class PoolsController {
  constructor(
    private readonly poolsService: PoolsService,
    private readonly cacheService: CacheService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get pool details by ID' })
  @ApiParam({ name: 'id', description: 'Pool ID (cuid or contract address)' })
  @ApiResponse({ status: 200, description: 'Pool details retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  async getPoolById(@Param('id') id: string) {
    const cacheKey = `pool:${id}`;
    
    // Try to get from cache first
    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Get from database/service
    const pool = await this.poolsService.findPoolById(id);
    if (!pool) {
      throw new NotFoundException(`Pool with ID ${id} not found`);
    }

    // Cache the result
    await this.cacheService.set(cacheKey, pool, 15); // 15 seconds TTL

    return pool;
  }
}
