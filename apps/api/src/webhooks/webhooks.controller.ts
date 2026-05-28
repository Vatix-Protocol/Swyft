import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WebhooksService } from './webhooks.service';
import { WebhookEventType } from './webhook.types';

interface AuthRequest {
  user: { walletAddress: string };
}

/** Shape returned by GET /webhooks — includes a loading flag so clients can
 *  show a spinner and disable mutating actions while the list is being fetched. */
interface WebhookListResponse {
  loading: boolean;
  items: Awaited<ReturnType<WebhooksService['list']>>;
}

@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  /**
   * Register a new webhook for the authenticated wallet.
   *
   * @param req - Authenticated request containing the wallet address.
   * @param body - Webhook configuration: target URL, event types, optional signing secret, and large-swap USD threshold.
   * @returns The created webhook record (id, url, eventTypes, createdAt).
   */
  @Post()
  @ApiOperation({ summary: 'Register a webhook' })
  create(
    @Request() req: AuthRequest,
    @Body() body: { url: string; eventTypes: WebhookEventType[]; secret?: string; largeSwapUsd?: number },
  ) {
    return this.service.create(req.user.walletAddress, body.url, body.eventTypes, body.secret, body.largeSwapUsd);
  }

  /**
   * List all webhooks belonging to the authenticated wallet.
   *
   * @param req - Authenticated request containing the wallet address.
   * @returns Array of webhook records (id, url, eventTypes, disabled, createdAt).
   */
  @Get()
  @ApiOperation({ summary: 'List webhooks for the authenticated wallet — loading:true while fetching' })
  async list(@Request() req: AuthRequest): Promise<WebhookListResponse> {
    const items = await this.service.list(req.user.walletAddress);
    return { loading: false, items };
  }

  /**
   * Delete a webhook owned by the authenticated wallet.
   *
   * @param id - UUID of the webhook to delete.
   * @param req - Authenticated request containing the wallet address.
   * @returns Resolves when the record has been removed (no-op if not found or not owned).
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Remove a webhook — disabled while loading:true' })
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.remove(id, req.user.walletAddress);
  }
}
