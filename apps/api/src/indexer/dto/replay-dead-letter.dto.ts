import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * BullMQ job ids and idempotency keys are echoed into logs and used as
 * BullMQ job-id suffixes, so only a conservative charset is accepted. This
 * rules out log forging (CR/LF), path-ish ids and oversized payloads.
 */
export const DLQ_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
export const DLQ_ID_MAX_LENGTH = 128;

/**
 * Body for `POST /indexer/dead-letters/replay` (#1026).
 *
 * Authz, kill switch and rate limit are enforced by `DlqReplayGuard` before
 * this DTO is validated; see docs/INDEXER_DLQ_REPLAY.md.
 */
export class ReplayDeadLetterDto {
  @ApiPropertyOptional({
    description:
      'Replay a single dead-letter job by its BullMQ jobId. Omit to replay all unrecovered entries (max 500).',
    example: 'job-123',
    maxLength: DLQ_ID_MAX_LENGTH,
    pattern: DLQ_ID_PATTERN.source,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(DLQ_ID_MAX_LENGTH)
  @Matches(DLQ_ID_PATTERN, {
    message: 'jobId may only contain letters, digits, ".", "_", ":" and "-"',
  })
  jobId?: string;
}
