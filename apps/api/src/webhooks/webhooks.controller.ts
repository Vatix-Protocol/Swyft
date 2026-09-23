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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WebhooksService } from './webhooks.service';
import {
  WebhookEventType,
  WEBHOOK_PAYLOAD_EXAMPLES,
  verifyWebhookSignature,
} from './webhook.types';
import { SWAGGER_TAGS } from '../swagger.constants';
import { CreateWebhookDto } from './dto/create-webhook.dto';

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
  @ApiBody({
    schema: {
      type: 'object',
      required: ['url', 'eventTypes'],
      properties: {
        url: { type: 'string', example: 'https://example.com/webhook' },
        eventTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'pool.created',
              'swap',
              'swap.large',
              'pool.tvl.milestone',
              'position.minted',
              'position.burned',
            ],
          },
          example: ['swap', 'swap.large'],
        },
        secret: { type: 'string', example: 'my-hmac-secret' },
        largeSwapUsd: { type: 'number', example: 10000 },
      },
    },
  })
  create(@Request() req: AuthRequest, @Body() body: CreateWebhookDto) {
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
   * Return example payloads for all webhook event types.
   * Useful for documentation and client integration.
   *
   * @returns Map of event type → example payload.
   */
  @Get('event-examples')
  @ApiOperation({
    summary: 'Return example payloads for all webhook event types',
  })
  eventExamples() {
    return WEBHOOK_PAYLOAD_EXAMPLES;
  }

  /**
   * Delete a webhook owned by the authenticated wallet.
   *
   * @param id - UUID of the webhook to delete.
   * @param req - Authenticated request containing the wallet address.
   * @returns Resolves when the record has been removed (no-op if not found or not owned).
   */
  @Get('audit')
  @ApiOperation({
    summary: 'Webhook CRUD audit log for the authenticated wallet',
  })
  auditLog(@Request() req: AuthRequest) {
    return this.service.auditLog(req.user.walletAddress);
  }

  /**
   * Re-queue all BullMQ-failed delivery jobs for the given webhook.
   * Only re-queues jobs owned by the authenticated wallet.
   *
   * @param id - UUID of the webhook whose failed deliveries to retry.
   * @returns Count of jobs that were re-queued.
   */
  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry failed deliveries for a webhook' })
  retryDeliveries(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.retryDeliveries(id, req.user.walletAddress);
  }

  /**
   * Send a test ping webhook to verify connectivity.
   * This endpoint sends a test event to the specified webhook URL
   * to verify that webhook delivery is working correctly.
   *
   * @param id - UUID of the webhook to test
   * @param req - Authenticated request containing the wallet address
   * @returns Information about the test ping attempt
   */
  @Post(':id/ping')
  @ApiOperation({ summary: 'Send a test ping webhook to verify connectivity' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        testEventType: {
          type: 'string',
          enum: [
            'pool.created',
            'swap',
            'swap.large',
            'pool.tvl.milestone',
            'position.minted',
            'position.burned',
          ],
          example: 'swap',
        },
      },
    },
  })
  ping(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() body?: { testEventType?: WebhookEventType },
  ) {
    const eventType: WebhookEventType = body?.testEventType ?? 'swap';
    return this.service.ping(id, req.user.walletAddress, eventType);
  }

  /**
   * Verify a webhook payload signature without persisting state.
   * Clients can use this to confirm the `X-Swyft-Signature` header is valid.
   *
   * @returns `{ valid: true }` when the signature matches, `{ valid: false }` otherwise.
   */
  @Post('verify-signature')
  @ApiOperation({ summary: 'Verify an HMAC-SHA256 webhook signature' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['payload', 'signature', 'secret'],
      properties: {
        payload: { type: 'string' },
        signature: { type: 'string' },
        secret: { type: 'string' },
      },
    },
  })
  verifySignature(
    @Body() body: { payload: string; signature: string; secret: string },
  ) {
    return {
      valid: verifyWebhookSignature(body.payload, body.signature, body.secret),
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a webhook — disabled while loading:true' })
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.remove(id, req.user.walletAddress);
  }
}
