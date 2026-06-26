import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { SWAGGER_TAGS } from '../swagger.constants';

@ApiTags(SWAGGER_TAGS.TOKENS)
@Controller('tokens')
export class TokensController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'List all known tokens, ordered by symbol' })
  @ApiResponse({ status: 200, description: 'List of tokens' })
  async getTokens() {
    const tokens = await this.prisma.token.findMany({
      orderBy: { symbol: 'asc' },
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
