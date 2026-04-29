import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WebhooksService } from './webhooks.service';
import { WebhookEventType } from './webhook.types';

interface AuthRequest {
  user: { walletAddress: string };
}

@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Register a webhook' })
  create(
    @Request() req: AuthRequest,
    @Body() body: { url: string; eventTypes: WebhookEventType[]; secret?: string; largeSwapUsd?: number },
  ) {
    return this.service.create(req.user.walletAddress, body.url, body.eventTypes, body.secret, body.largeSwapUsd);
  }

  @Get()
  @ApiOperation({ summary: 'List webhooks for the authenticated wallet' })
  list(@Request() req: AuthRequest) {
    return this.service.list(req.user.walletAddress);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a webhook' })
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.remove(id, req.user.walletAddress);
  }
}
