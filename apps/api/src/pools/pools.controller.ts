import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { GetPoolsQueryDto } from './dto/get-pools-query.dto';
import { GetTicksQueryDto } from './dto/get-ticks-query.dto';
import { PoolsListResponse, PoolsService } from './pools.service';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { CacheService } from '../cache/cache.service';


@ApiTags('pools')
@Controller('pools')
export class PoolsController {
  constructor(
    private readonly poolsService: PoolsService,
    private readonly cacheService: CacheService,
  ) {}


  @Get()
  getPools(@Query() query: GetPoolsQueryDto): Promise<PoolsListResponse> {
    return this.poolsService.getPools(query);
  }

  @Get(':id/ticks')
  @ApiOperation({ summary: 'Get initialized ticks for a pool' })
  @ApiParam({ name: 'id', description: 'Pool ID' })
  @ApiQuery({ name: 'lowerTick', required: false, type: Number })
  @ApiQuery({ name: 'upperTick', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Tick data returned in ascending order' })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  getPoolTicks(
    @Param('id') id: string,
    @Query() query: GetTicksQueryDto,
  ) {
    return this.poolsService.getPoolTicks(id, query.lowerTick, query.upperTick);
  }

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

  @Get(':id/ticks')
  @ApiOperation({ summary: 'Get initialized ticks for a pool' })
  @ApiParam({ name: 'id', description: 'Pool ID (cuid or contract address)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Ticks retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tickIndex: { type: 'number' },
          liquidityNet: { type: 'string' },
          liquidityGross: { type: 'string' },
          feeGrowthOutside0X128: { type: 'string' },
          feeGrowthOutside1X128: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  async getPoolTicks(
    @Param('id') poolId: string,
    @Query() query: GetTicksQueryDto,
  ): Promise<TickData[]> {
    // Validate pool exists first
    const pool = await this.poolsService.findPoolById(poolId);
    if (!pool) {
      throw new NotFoundException(`Pool with ID ${poolId} not found`);
    }

    // Validate tick range if provided
    if (query.lowerTick !== undefined && query.upperTick !== undefined) {
      if (query.lowerTick > query.upperTick) {
        throw new BadRequestException('lowerTick must be less than or equal to upperTick');
      }
    }

    // Get ticks from service
    const ticks = await this.poolsService.getPoolTicks(poolId, query);

    return ticks;
  }
}
