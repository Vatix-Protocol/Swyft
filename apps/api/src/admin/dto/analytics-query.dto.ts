import { IsEnum, IsOptional } from 'class-validator';

export enum TimeInterval {
  ONE_DAY = '1d',
  SEVEN_DAYS = '7d',
  THIRTY_DAYS = '30d',
}

export class TimeSeriesQueryDto {
  @IsOptional()
  @IsEnum(TimeInterval)
  interval?: TimeInterval = TimeInterval.SEVEN_DAYS;
}
