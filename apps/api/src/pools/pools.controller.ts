import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CacheService } from '../cache/cache.service';
import { GetPoolsQueryDto } from './dto/get-pools-query.dto';
import { GetTicksQueryDto } from './dto/get-ticks-query.dto';
import { TickData } from './pools.repository';
import { PoolsListResponse, PoolsService } from './pools.service';

@ApiTags('pools')
@Controller('pools')
export class PoolsController {
  constructor(
    private readonly poolsService: PoolsService,
    private readonly cacheService: CacheService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List active pools' })
  @ApiResponse({
    status: 200,
    description: 'Returns a paginated list of pools. Items array is empty when no pools match.',
  })
  async getPools(@Query() query: GetPoolsQueryDto): Promise<PoolsListResponse> {
    const result = await this.poolsService.getPools(query);

    // Empty result is valid — return it as-is so the UI can render an empty state
    return result;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get pool details by ID' })
  @ApiParam({ name: 'id', description: 'Pool ID (cuid or contract address)' })
  @ApiResponse({ status: 200, description: 'Pool details retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  async getPoolById(@Param('id') id: string) {
    const cacheKey = `pool:${id}`;

    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pool = await this.poolsService.findPoolById(id);
    if (!pool) {
      throw new NotFoundException(
        `Pool with ID "${id}" not found. Check the ID and try again.`,
      );
    }

    await this.cacheService.set(cacheKey, pool, 15);
    return pool;
  }

  @Get(':id/ticks')
  @ApiOperation({ summary: 'Get initialized ticks for a pool' })
  @ApiParam({ name: 'id', description: 'Pool ID (cuid or contract address)' })
  @ApiQuery({ name: 'lowerTick', required: false, type: Number })
  @ApiQuery({ name: 'upperTick', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description:
      'Tick data returned in ascending order. Returns an empty array when no ticks exist in the requested range.',
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
  @ApiResponse({ status: 400, description: 'Invalid tick range' })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  async getPoolTicks(
    @Param('id') id: string,
    @Query() query: GetTicksQueryDto,
  ): Promise<TickData[]> {
    const pool = await this.poolsService.findPoolById(id);
    if (!pool) {
      throw new NotFoundException(
        `Pool with ID "${id}" not found. Check the ID and try again.`,
      );
    }

    if (
      query.lowerTick !== undefined &&
      query.upperTick !== undefined &&
      query.lowerTick > query.upperTick
    ) {
      throw new BadRequestException(
        'lowerTick must be less than or equal to upperTick.',
      );
    }

    // Empty array is a valid response — the pool exists but has no ticks in this range
    return this.poolsService.getPoolTicks(id, query.lowerTick, query.upperTick);
  }
}
