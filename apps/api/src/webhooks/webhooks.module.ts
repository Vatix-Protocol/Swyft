import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookWorker } from './webhook.processor';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookWorker],
  exports: [WebhooksService],
})
export class WebhooksModule {}
