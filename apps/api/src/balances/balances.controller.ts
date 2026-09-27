import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SWAGGER_TAGS } from '../swagger.constants';
import { GetBalancesQueryDto } from './dto/get-balances-query.dto';
import { GetPositionMetadataQueryDto } from './dto/get-position-metadata-query.dto';
import { BalancesService } from './balances.service';

@ApiTags(SWAGGER_TAGS.BALANCES)
@ApiSecurity('api-key')
@Controller('balances')
@UseGuards(ApiKeyGuard)
export class BalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  @Get()
  @ApiOperation({
    summary: 'Get on-chain token balances for a wallet address',
    description:
      "Queries each tracked SAC token contract's `balance` function via " +
      'Soroban RPC for the given wallet address. Returns a map of token ' +
      'contract address to a human-readable decimal balance string. A ' +
      "token the wallet has never held comes back as a real \"0\" (the " +
      'contract itself reports zero); a token missing from the map means ' +
      'its balance could not be determined, not that it is zero.',
  })
  @ApiResponse({
    status: 200,
    description: 'Map of token contract address -> decimal balance string',
    schema: {
      type: 'object',
      additionalProperties: { type: 'string' },
      example: {
        CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA: '125.5',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'address is missing or not a valid Stellar wallet address',
  })
  @ApiResponse({
    status: 503,
    description: 'The Stellar RPC endpoint is unreachable or timed out',
  })
  getBalances(
    @Query() query: GetBalancesQueryDto,
  ): Promise<Record<string, string>> {
    return this.balancesService.getBalances(query.address);
  }

  @Get('positions/metadata')
  @ApiOperation({
    summary: 'Get standardized metadata for a position NFT',
    description:
      'Returns the canonical metadata document for a position NFT, ' +
      'conforming to the Swyft position NFT metadata standard documented ' +
      'in CONTRACTS.md. The on-chain contract remains the source of truth ' +
      'for ownership and balances; this endpoint only projects that state ' +
      'into a stable, typed metadata shape. Requests are authorized ' +
      'deny-by-default via the API key guard and are idempotent: repeated ' +
      'or concurrent reads for the same position id return the same ' +
      'document. If the Soroban RPC dependency is unavailable the request ' +
      'fails closed with 503 rather than returning partial metadata.',
  })
  @ApiResponse({
    status: 200,
    description: 'Standardized position NFT metadata document',
    schema: {
      type: 'object',
      required: ['positionId', 'name', 'symbol', 'decimals', 'attributes'],
      properties: {
        positionId: { type: 'string' },
        name: { type: 'string' },
        symbol: { type: 'string' },
        decimals: { type: 'integer' },
        attributes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['trait_type', 'value'],
            properties: {
              trait_type: { type: 'string' },
              value: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'positionId is missing or not a valid position identifier',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller is not authorized to read position metadata',
  })
  @ApiResponse({
    status: 503,
    description: 'The Stellar RPC endpoint is unreachable or timed out',
  })
  getPositionMetadata(
    @Query() query: GetPositionMetadataQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.balancesService.getPositionMetadata(query.positionId);
  }
}
