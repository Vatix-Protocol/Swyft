import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiKeysService } from './api-keys.service';

interface AuthRequest {
  user: { walletAddress: string };
}

@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth/api-keys')
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Post()
  @ApiOperation({ summary: 'Generate a new API key — returned once only' })
  create(@Request() req: AuthRequest, @Body('label') label: string) {
    return this.service.create(req.user.walletAddress, label ?? 'default');
  }

  @Get()
  @ApiOperation({ summary: 'List active API keys for the authenticated wallet' })
  list(@Request() req: AuthRequest) {
    return this.service.list(req.user.walletAddress);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key' })
  revoke(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.revoke(id, req.user.walletAddress);
  }
}
