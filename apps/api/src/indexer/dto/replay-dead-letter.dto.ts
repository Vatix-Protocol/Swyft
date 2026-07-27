import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReplayDeadLetterDto {
  @ApiPropertyOptional({
    description:
      'Replay a single dead-letter job by its BullMQ jobId. Omit to replay all unrecovered entries.',
    example: 'job-123',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  jobId?: string;
}
