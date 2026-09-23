import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReplayDto {
  @ApiProperty({
    description: 'Re-enqueue every persisted event from this ledger onward',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fromLedger!: number;
}
