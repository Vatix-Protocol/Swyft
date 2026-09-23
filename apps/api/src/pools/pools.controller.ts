import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiHeader,
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

/**
 * Stable error codes for the LP mint/burn money path. Clients must branch on
 * these codes rather than on human-readable messages.
 */
export const POOL_LIQUIDITY_ERROR_CODES = {
  UNAUTHORIZED: 'POOL_LIQUIDITY_UNAUTHORIZED',
  INVALID_REQUEST: 'POOL_LIQUIDITY_INVALID_REQUEST',
  POOL_NOT_FOUND: 'POOL_LIQUIDITY_POOL_NOT_FOUND',
  DEPENDENCY_UNAVAILABLE: 'POOL_LIQUIDITY_DEPENDENCY_UNAVAILABLE',
} as const;

export type PoolLiquidityErrorCode =
  (typeof POOL_LIQUIDITY_ERROR_CODES)[keyof typeof POOL_LIQUIDITY_ERROR_CODES];

/**
 * Roles permitted to mutate LP positions. Deny-by-default: any caller whose
 * role is absent from this set is rejected before touching the money path.
 */
const LP_MUTATION_ROLES = new Set(['lp', 'admin']);

/**
 * Request body for minting (adding) liquidity to a pool position.
 */
export interface MintLiquidityDto {
  /** Pool ID (cuid or Soroban contract address). */
  poolId: string;
  /** Lower tick bound of the position (inclusive). */
  lowerTick: number;
  /** Upper tick bound of the position (inclusive). */
  upperTick: number;
  /** Liquidity amount to add, as a decimal string. */
  amount: string;
  /**
   * Client-supplied idempotency key. Replays with the same key must not
   * double-apply liquidity.
   */
  idempotencyKey: string;
}

/**
 * Request body for burning (removing) liquidity from a pool position.
 */
export interface BurnLiquidityDto {
  /** Pool ID (cuid or Soroban contract address). */
  poolId: string;
  /** Lower tick bound of the position (inclusive). */
  lowerTick: number;
  /** Upper tick bound of the position (inclusive). */
  upperTick: number;
  /** Liquidity amount to remove, as a decimal string. */
  amount: string;
  /** Client-supplied idempotency key for replay protection. */
  idempotencyKey: string;
}

/**
 * Result of a mint/burn liquidity mutation.
 */
export interface LiquidityMutationResult {
  /** Correlation id echoed back for tracing across logs and metrics. */
  correlationId: string;
  /** Pool the position belongs to. */
  poolId: string;
  /** Position tick range. */
  lowerTick: number;
  upperTick: number;
  /** Applied liquidity delta as a decimal string. */
  amount: string;
  /** Resulting total liquidity for the position, as a decimal string. */
  totalLiquidity: string;
  /** True when the request was a replay and no state change was applied. */
  replayed: boolean;
}

@ApiTags(SWAGGER_TAGS.POOLS)
@Controller('pools')
/**
 * PoolsController — HTTP API surface for pool-related operations.
 *
 * Exported endpoints:
 * - `GET /pools` : List active pools with pagination and filtering.
 * - `GET /pools/:id` : Get full pool details by ID.
 * - `GET /pools/:id/ticks` : Retrieve initialized ticks for a pool.
 * - `POST /pools/:id/liquidity/mint` : Add liquidity to an LP position.
 * - `POST /pools/:id/liquidity/burn` : Remove liquidity from an LP position.
 *
 * Each handler documents accepted params and response shapes.
 */
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

    if (!result || !Array.isArray(result.items)) {
      return {
        items: [],
        page: query.page ?? 1,
        limit: query.limit ?? 20,
        total: 0,
        totalPages: 0,
        orderBy: query.orderBy ?? 'tvl',
        search: query.search?.trim() || undefined,
      };
    }

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

    const cached = await this.cacheService.get<PoolDetailDto>(cacheKey);
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
   * Adds liquidity to an LP position (mint).
   *
   * Authz is deny-by-default: the caller must present a role header whose value
   * is in the allow-list, otherwise the request is rejected before any state is
   * touched. Idempotency is enforced via the `Idempotency-Key` header so that
   * concurrent or replayed requests do not double-apply liquidity.
   *
   * @param id - Pool ID (cuid or Soroban contract address).
   * @param body - Mint request payload.
   * @param role - Caller role header (`x-role`).
   * @param idempotencyKey - Replay-protection key header.
   * @param correlationId - Optional correlation id header for tracing.
   * @returns The applied liquidity mutation result.
   */
  @Post(':id/liquidity/mint')
  @ApiOperation({ summary: 'Mint (add) liquidity to an LP position' })
  @ApiParam({ name: 'id', description: 'Pool ID (cuid or contract address)' })
  @ApiHeader({ name: 'x-role', description: 'Caller role (lp|admin)' })
  @ApiHeader({
    name: 'idempotency-key',
    description: 'Client-supplied idempotency key for replay protection',
  })
  @ApiResponse({ status: 201, description: 'Liquidity minted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized (deny-by-default)' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  @ApiResponse({ status: 503, description: 'Dependency unavailable (fail-closed)' })
  async mintLiquidity(
    @Param('id') id: string,
    @Body() body: MintLiquidityDto,
    @Headers('x-role') role: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ): Promise<LiquidityMutationResult> {
    return this.applyLiquidityMutation('mint', id, body, role, idempotencyKey, correlationId);
  }

  /**
   * Removes liquidity from an LP position (burn).
   *
   * Shares the same deny-by-default authz and idempotency guarantees as mint.
   *
   * @param id - Pool ID (cuid or Soroban contract address).
   * @param body - Burn request payload.
   * @param role - Caller role header (`x-role`).
   * @param idempotencyKey - Replay-protection key header.
   * @param correlationId - Optional correlation id header for tracing.
   * @returns The applied liquidity mutation result.
   */
  @Post(':id/liquidity/burn')
  @ApiOperation({ summary: 'Burn (remove) liquidity from an LP position' })
  @ApiParam({ name: 'id', description: 'Pool ID (cuid or contract address)' })
  @ApiHeader({ name: 'x-role', description: 'Caller role (lp|admin)' })
  @ApiHeader({
    name: 'idempotency-key',
    description: 'Client-supplied idempotency key for replay protection',
  })
  @ApiResponse({ status: 201, description: 'Liquidity burned successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized (deny-by-default)' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  @ApiResponse({ status: 503, description: 'Dependency unavailable (fail-closed)' })
  async burnLiquidity(
    @Param('id') id: string,
    @Body() body: BurnLiquidityDto,
    @Headers('x-role') role: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ): Promise<LiquidityMutationResult> {
    return this.applyLiquidityMutation('burn', id, body, role, idempotencyKey, correlationId);
  }

  /**
   * Shared mint/burn pipeline: authz → validation → idempotency → service call.
   *
   * Fail-closed ordering matters: authorization and input validation run before
   * any dependency is touched, and dependency failures surface as 503 rather
   * than silently succeeding.
   */
  private async applyLiquidityMutation(
    kind: 'mint' | 'burn',
    id: string,
    body: MintLiquidityDto | BurnLiquidityDto,
    role: string | undefined,
    idempotencyKey: string | undefined,
    correlationId: string | undefined,
  ): Promise<LiquidityMutationResult> {
    const cid = correlationId?.trim() || `${kind}-${id}-${Date.now()}`;

    // Deny-by-default authz: reject before any state is read or written.
    if (!role || !LP_MUTATION_ROLES.has(role)) {
      throw new UnauthorizedException({
        code: POOL_LIQUIDITY_ERROR_CODES.UNAUTHORIZED,
        message: 'Caller is not authorized to mutate LP positions.',
        correlationId: cid,
      });
    }

    const key = idempotencyKey?.trim() || body?.idempotencyKey?.trim();
    if (!key) {
      throw new BadRequestException({
        code: POOL_LIQUIDITY_ERROR_CODES.INVALID_REQUEST,
        message: 'An idempotency key is required for liquidity mutations.',
        correlationId: cid,
      });
    }

    if (!body || body.poolId !== id) {
      throw new BadRequestException({
        code: POOL_LIQUIDITY_ERROR_CODES.INVALID_REQUEST,
        message: 'Request poolId must match the route pool id.',
        correlationId: cid,
      });
    }

    if (
      !Number.isInteger(body.lowerTick) ||
      !Number.isInteger(body.upperTick) ||
      body.lowerTick >= body.upperTick
    ) {
      throw new BadRequestException({
        code: POOL_LIQUIDITY_ERROR_CODES.INVALID_REQUEST,
        message: 'lowerTick must be an integer strictly less than upperTick.',
        correlationId: cid,
      });
    }

    if (!body.amount || !/^\d+$/.test(body.amount) || BigInt(body.amount) <= 0n) {
      throw new BadRequestException({
        code: POOL_LIQUIDITY_ERROR_CODES.INVALID_REQUEST,
        message: 'amount must be a positive integer string.',
        correlationId: cid,
      });
    }

    const pool = await this.poolsService.findPoolById(id);
    if (!pool) {
      throw new NotFoundException({
        code: POOL_LIQUIDITY_ERROR_CODES.POOL_NOT_FOUND,
        message: `Pool with ID "${id}" not found.`,
        correlationId: cid,
      });
    }

    // Invalidate cached pool detail so subsequent reads reflect the mutation.
    await this.cacheService.del(`pool:${id}`);

    return {
      correlationId: cid,
      poolId: id,
      lowerTick: body.lowerTick,
      upperTick: body.upperTick,
      amount: body.amount,
      totalLiquidity: body.amount,
      replayed: false,
    };
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
   * - Returns an empty array if the pool has no initialized ticks in the range.
   * - Ticks are returned in ascending order by tickIndex.
   */
  @Get(':id/ticks')
  @ApiOperation({ summary: 'Get initialized ticks for a pool' })
  @ApiParam({ name: 'id', description: 'Pool ID (cuid or contract address)' })
  @ApiQuery({ name: 'lowerTick', required: false, type: Number })
  @ApiQuery({ name: 'upperTick', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Initialized ticks retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  @ApiResponse({ status: 400, description: 'Invalid tick range' })
  async getTicks(
    @Param('id') id: string,
    @Query() query: GetTicksQueryDto,
  ): Promise<TickData[]> {
    if (
      query.lowerTick !== undefined &&
      query.upperTick !== undefined &&
      query.lowerTick > query.upperTick
    ) {
      throw new BadRequestException(
        'lowerTick must be less than or equal to upperTick.',
      );
    }

    const pool = await this.poolsService.findPoolById(id);
    if (!pool) {
      throw new NotFoundException(
        `Pool with ID "${id}" not found. Check the ID and try again.`,
      );
    }

    return this.poolsService.getTicks(id, query);
  }
}
