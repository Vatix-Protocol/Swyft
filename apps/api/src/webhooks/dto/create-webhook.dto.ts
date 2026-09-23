import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { WEBHOOK_EVENTS, WebhookEventType } from '../webhook.types';

export class CreateWebhookDto {
  /**
   * Webhook target URL. Restricted to https:// so registered endpoints can't
   * point at plaintext http, file://, or other non-HTTPS schemes.
   */
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(WEBHOOK_EVENTS, { each: true })
  eventTypes: WebhookEventType[];

  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsNumber()
  largeSwapUsd?: number;
}
