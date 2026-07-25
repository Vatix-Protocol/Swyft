import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkPositionsDto {
  @ApiProperty({
    description: 'Wallet addresses to fetch positions for',
    type: [String],
    maxItems: 50,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  wallets!: string[];

  @ApiPropertyOptional({
    description: 'Filter by position status',
    enum: ['active', 'closed', 'all'],
    default: 'all',
  })
  @IsIn(['active', 'closed', 'all'])
  @IsOptional()
  status?: 'active' | 'closed' | 'all' = 'all';
}
