import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SWAGGER_TAGS } from '../swagger.constants';
import { GetTokensQueryDto } from './dto/get-tokens-query.dto';

@ApiTags(SWAGGER_TAGS.TOKENS)
@ApiSecurity('api-key')
@Controller('tokens')
@UseGuards(ApiKeyGuard)
export class TokensController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'List all known tokens, ordered by symbol' })
  @ApiResponse({ status: 200, description: 'List of tokens' })
  @ApiResponse({
    status: 400,
    description: 'limit exceeds the maximum page size (100)',
  })
  async getTokens(@Query() query?: GetTokensQueryDto) {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 50;

    const tokens = await this.prisma.token.findMany({
      orderBy: { symbol: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        address: true,
        symbol: true,
        name: true,
        decimals: true,
        logoUri: true,
      },
    });

    return tokens.map(({ address, ...rest }) => ({
      contractAddress: address,
      ...rest,
    }));
  }
}
