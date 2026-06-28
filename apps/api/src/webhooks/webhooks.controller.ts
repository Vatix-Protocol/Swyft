import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WebhooksService } from './webhooks.service';
import { WebhookEventType } from './webhook.types';
import { SWAGGER_TAGS } from '../swagger.constants';

interface AuthRequest {
  user: { walletAddress: string };
}

interface WebhookListResponse {
  loading: boolean;
  items: Awaited<ReturnType<WebhooksService['list']>>;
}

@ApiTags(SWAGGER_TAGS.WEBHOOKS)
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Register a webhook' })
  create(
    @Request() req: AuthRequest,
    @Body()
    body: {
      url: string;
      eventTypes: WebhookEventType[];
      secret?: string;
      largeSwapUsd?: number;
    },
  ) {
    return this.service.create(
      req.user.walletAddress,
      body.url,
      body.eventTypes,
      body.secret,
      body.largeSwapUsd,
    );
  }

  @Get()
  @ApiOperation({
    summary:
      'List webhooks for the authenticated wallet — loading:true while fetching',
  })
  async list(@Request() req: AuthRequest): Promise<WebhookListResponse> {
    const items = await this.service.list(req.user.walletAddress);
    return { loading: false, items };
  }

  /**
   * Audit log for all webhook CRUD operations performed by the authenticated wallet.
   * Returns entries in reverse-chronological order (most recent first).
   */
  @Get('audit')
  @ApiOperation({ summary: 'Webhook CRUD audit log for the authenticated wallet' })
  auditLog(@Request() req: AuthRequest) {
    return this.service.auditLog(req.user.walletAddress);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a webhook — disabled while loading:true' })
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.remove(id, req.user.walletAddress);
  }
}
