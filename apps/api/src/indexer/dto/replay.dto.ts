import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Stable error codes for the indexer dead-letter replay surface.
 *
 * These codes are part of the public contract: clients and runbooks may
 * branch on them, so they must not be renamed without a versioned change.
 */
export const REPLAY_ERROR_CODES = {
  /** Caller is not authorized to trigger replay (deny-by-default). */
  UNAUTHORIZED: 'INDEXER_REPLAY_UNAUTHORIZED',
  /** Caller is authenticated but lacks the required role/scope. */
  FORBIDDEN: 'INDEXER_REPLAY_FORBIDDEN',
  /** Request payload failed validation. */
  INVALID_REQUEST: 'INDEXER_REPLAY_INVALID_REQUEST',
  /** A dependency (RPC/DB/Redis) is unavailable; writes fail closed. */
  DEPENDENCY_UNAVAILABLE: 'INDEXER_REPLAY_DEPENDENCY_UNAVAILABLE',
  /** Replay is disabled by kill-switch / feature flag. */
  DISABLED: 'INDEXER_REPLAY_DISABLED',
  /** The referenced dead-letter entry does not exist. */
  NOT_FOUND: 'INDEXER_REPLAY_NOT_FOUND',
  /** The dead-letter entry was already replayed (idempotent no-op). */
  ALREADY_REPLAYED: 'INDEXER_REPLAY_ALREADY_REPLAYED',
  /** Replay exceeded the configured rate limit. */
  RATE_LIMITED: 'INDEXER_REPLAY_RATE_LIMITED',
  /** Unexpected internal failure. */
  INTERNAL: 'INDEXER_REPLAY_INTERNAL',
} as const;

export type ReplayErrorCode =
  (typeof REPLAY_ERROR_CODES)[keyof typeof REPLAY_ERROR_CODES];

/**
 * Replay scope. `single` targets one dead-letter entry, `range` targets a
 * bounded cursor window. Anything else is rejected by validation.
 */
export const REPLAY_SCOPES = ['single', 'range'] as const;
export type ReplayScope = (typeof REPLAY_SCOPES)[number];

/**
 * Request body for `POST /indexer/dlq/replay`.
 *
 * Idempotency: callers MUST supply an `idempotencyKey`. Concurrent or
 * replayed requests carrying the same key resolve to the same outcome and
 * never double-apply a dead-letter entry.
 */
export class ReplayDeadLetterDto {
  @ApiProperty({
    description:
      'Client-supplied idempotency key. Replays with the same key are deduped.',
    example: '3f1c9b2e-6a4d-4f0e-9c1a-2b7d5e8f0a11',
  })
  @IsUUID('4')
  idempotencyKey!: string;

  @ApiPropertyOptional({
    description: 'Replay a single dead-letter entry by id.',
    example: 'dlq_01HZX8Q2K7M3N4P5R6S7T8V9W0',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  deadLetterId?: string;

  @ApiPropertyOptional({
    description:
      'Replay a bounded cursor window. Mutually exclusive with deadLetterId.',
    example: 'cursor_01HZX8Q2K7M3N4P5R6S7T8V9W0',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of entries to replay in a range request.',
    default: 100,
    minimum: 1,
    maximum: 1000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'When true, validates and reports the replay plan without applying it.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description: 'Free-form reason recorded in the audit log.',
    example: 'recover from RPC outage 2024-06-01',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string;
}

/**
 * Request body for `POST /indexer/dlq/replay/batch`.
 *
 * Bounded to prevent griefing: at most 100 entries per request.
 */
export class ReplayDeadLetterBatchDto {
  @ApiProperty({
    description:
      'Client-supplied idempotency key. Replays with the same key are deduped.',
    example: '9c1a2b7d-5e8f-4a11-8b2e-6a4d4f0e9c1a',
  })
  @IsUUID('4')
  idempotencyKey!: string;

  @ApiProperty({
    description: 'Dead-letter entry ids to replay.',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(128, { each: true })
  deadLetterIds!: string[];

  @ApiPropertyOptional({
    description:
      'When true, validates and reports the replay plan without applying it.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description: 'Free-form reason recorded in the audit log.',
    example: 'bulk recovery after dependency outage',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string;
}

/**
 * Response envelope for replay requests. Always carries a correlation id so
 * ops can trace a replay across logs and metrics without exposing payloads.
 */
export class ReplayDeadLetterResponseDto {
  @ApiProperty({ description: 'Correlation id for this replay request.' })
  correlationId!: string;

  @ApiProperty({ description: 'Idempotency key echoed back to the caller.' })
  idempotencyKey!: string;

  @ApiProperty({
    description: 'Whether the request was applied or deduped as a no-op.',
    enum: ['applied', 'deduped', 'dry_run'],
  })
  @IsIn(['applied', 'deduped', 'dry_run'])
  status!: 'applied' | 'deduped' | 'dry_run';

  @ApiProperty({ description: 'Number of dead-letter entries replayed.' })
  replayed!: number;

  @ApiProperty({ description: 'Number of entries skipped (already replayed).' })
  skipped!: number;

  @ApiProperty({
    description: 'Stable error code when the request failed.',
    required: false,
    enum: Object.values(REPLAY_ERROR_CODES),
  })
  errorCode?: ReplayErrorCode;
}
