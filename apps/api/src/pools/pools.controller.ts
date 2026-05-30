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
import { PoolDetailDto } from './dto/pool-detail.dto';
import { TickData } from './pools.repository';
import { PoolsListResponse, PoolsService } from './pools.service';
import { SWAGGER_TAGS } from '../swagger.constants';

@ApiTags(SWAGGER_TAGS.POOLS)
@Controller('pools')
export class PoolsController {
  constructor(
    private readonly poolsService: PoolsService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Retrieves a paginated list of active pools with optional filtering and sorting.
   *
   * @param {GetPoolsQueryDto} query - Query parameters for filtering and pagination
   * @param {number} [query.page] - Page number (1-indexed). Defaults to 1
   * @param {number} [query.limit] - Number of pools per page. Defaults to 20
   * @param {string} [query.orderBy] - Sort order: 'tvl', 'volume24h', or 'feeApr'. Defaults to 'tvl'
   * @param {string} [query.search] - Optional search term to filter pools by token symbols or addresses
   *
   * @returns {Promise<PoolsListResponse>} Paginated list of pools with metadata
   * @returns {Array<Object>} items - Pool list items
   * @returns {string} items[].id - Pool unique identifier
   * @returns {string} items[].token0 - Token 0 address or symbol
   * @returns {string} items[].token1 - Token 1 address or symbol
   * @returns {string} items[].feeTier - Fee tier in basis points
   * @returns {number} items[].tvl - Total value locked
   * @returns {number} items[].volume24h - 24-hour trading volume
   * @returns {number} items[].feeApr - Annual percentage rate from fees
   * @returns {number} items[].currentPrice - Current pool price
   * @returns {number} page - Current page number
   * @returns {number} limit - Items per page
   * @returns {number} total - Total number of pools matching query
   * @returns {number} totalPages - Total number of pages
   * @returns {string} orderBy - Current sort order
   * @returns {string} [search] - Applied search term if provided
   *
   * @throws Returns 200 with empty items array if no pools match the query
   */
  @Get()
  @ApiOperation({ summary: 'List active pools' })
  @ApiResponse({
    status: 200,
    description:
      'Returns a paginated list of pools. Items array is empty when no pools match.',
  })
  /**
   * Returns a paginated list of active pools.
   *
   * @param query - Pagination and filter options (page, limit, feeTier, token).
   * @returns A paginated response containing pool summaries and total count.
   */
  async getPools(@Query() query: GetPoolsQueryDto): Promise<PoolsListResponse> {
    const result = await this.poolsService.getPools(query);

    // Empty result is valid — return it as-is so the UI can render an empty state
    return result;
  }

  /**
   * Retrieves detailed information for a specific pool by ID.
   *
   * @param {string} id - Pool unique identifier (cuid or contract address)
   *
   * @returns {Promise<PoolDetailDto>} Comprehensive pool details
   * @returns {string} id - Pool unique identifier
   * @returns {Object} token0 - Token 0 information
   * @returns {string} token0.address - Token 0 contract address
   * @returns {string} token0.symbol - Token 0 symbol
   * @returns {string} token0.name - Token 0 name
   * @returns {number} token0.decimals - Token 0 decimal places
   * @returns {Object} token1 - Token 1 information
   * @returns {string} token1.address - Token 1 contract address
   * @returns {string} token1.symbol - Token 1 symbol
   * @returns {string} token1.name - Token 1 name
   * @returns {number} token1.decimals - Token 1 decimal places
   * @returns {number} feeTier - Fee tier in basis points
   * @returns {string} currentSqrtPrice - Current square root price
   * @returns {number} currentTick - Current tick index
   * @returns {string} totalLiquidity - Total liquidity in the pool
   * @returns {string} tvl - Total value locked
   * @returns {string} volume24h - 24-hour trading volume
   * @returns {string} volume7d - 7-day trading volume
   * @returns {string} feeApr - Annual percentage rate from fees
   * @returns {number} creationTimestamp - Unix timestamp of pool creation
   * @returns {Array<Object>} recentSwaps - Array of recent swap transactions
   * @returns {string} recentSwaps[].id - Swap transaction ID
   * @returns {number} recentSwaps[].timestamp - Swap timestamp
   * @returns {string} recentSwaps[].token0Amount - Token 0 amount
   * @returns {string} recentSwaps[].token1Amount - Token 1 amount
   * @returns {string} recentSwaps[].price - Swap price
   * @returns {'buy'|'sell'} recentSwaps[].type - Swap type
   * @returns {string} recentSwaps[].txHash - Transaction hash
   *
   * @throws {NotFoundException} 404 - Pool with the specified ID not found
   * @throws {BadRequestException} 400 - Invalid pool ID format
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get pool details by ID' })
  @ApiParam({ name: 'id', description: 'Pool ID (cuid or contract address)' })
  @ApiResponse({
    status: 200,
    type: PoolDetailDto,
    description: 'Pool details retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  /**
   * Returns full details for a single pool, including token pair, fee tier, and current price.
   * Results are cached for 15 seconds.
   *
   * @param id - Pool ID (cuid) or Soroban contract address.
   * @returns Pool detail object.
   * @throws NotFoundException when no pool matches the given ID.
   */
  async getPoolById(@Param('id') id: string): Promise<PoolDetailDto> {
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

  /**
   * Retrieves initialized ticks for a specific pool, optionally filtered by tick range.
   *
   * @param {string} id - Pool unique identifier (cuid or contract address)
   * @param {GetTicksQueryDto} query - Query parameters for tick filtering
   * @param {number} [query.lowerTick] - Lower bound tick index (inclusive). Optional
   * @param {number} [query.upperTick] - Upper bound tick index (inclusive). Optional
   *
   * @returns {Promise<TickData[]>} Array of initialized ticks in ascending order by tickIndex
   * @returns {number} [].tickIndex - Tick index
   * @returns {string} [].liquidityNet - Net liquidity change at this tick
   * @returns {string} [].liquidityGross - Gross liquidity at this tick
   * @returns {string} [].feeGrowthOutside0X128 - Fee growth outside for token0
   * @returns {string} [].feeGrowthOutside1X128 - Fee growth outside for token1
   *
   * @throws {NotFoundException} 404 - Pool with the specified ID not found
   * @throws {BadRequestException} 400 - Invalid tick range (lowerTick > upperTick)
   *
   * @remarks
   * - Returns an empty array if the pool exists but has no ticks in the requested range
   * - If lowerTick and upperTick are both omitted, all initialized ticks are returned
   * - Tick indices are returned in ascending order
   */
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
        required: [
          'tickIndex',
          'liquidityNet',
          'liquidityGross',
          'feeGrowthOutside0X128',
          'feeGrowthOutside1X128',
        ],
        properties: {
          tickIndex: { type: 'number', description: 'Tick index' },
          liquidityNet: {
            type: 'string',
            description: 'Net liquidity change at this tick',
          },
          liquidityGross: {
            type: 'string',
            description: 'Gross liquidity at this tick',
          },
          feeGrowthOutside0X128: {
            type: 'string',
            description: 'Fee growth outside for token0',
          },
          feeGrowthOutside1X128: {
            type: 'string',
            description: 'Fee growth outside for token1',
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid tick range' })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  /**
   * Returns initialized tick data for a pool, optionally filtered to a tick range.
   * Ticks are returned in ascending order by tick index.
   *
   * @param id - Pool ID (cuid) or Soroban contract address.
   * @param query - Optional `lowerTick` and `upperTick` bounds (inclusive). If omitted, all ticks are returned.
   * @returns Array of tick data objects. Empty array when the pool has no ticks in the requested range.
   * @throws NotFoundException when no pool matches the given ID.
   * @throws BadRequestException when `lowerTick` is greater than `upperTick`.
   */
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
