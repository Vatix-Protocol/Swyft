import { Controller, Get } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Controller('tokens')
export class TokensController {
  private readonly prisma = new PrismaClient();

  @Get()
  async getTokens() {
    return this.prisma.token.findMany({
      orderBy: { symbol: 'asc' },
      select: {
        contractAddress: true,
        symbol: true,
        name: true,
        decimals: true,
        logoUri: true,
      },
    });
  }
}
