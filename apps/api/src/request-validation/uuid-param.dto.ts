import { IsUUID } from 'class-validator';

/**
 * Use with @Param() on any endpoint that takes a UUID path parameter.
 *
 * @example
 * @Get(':id')
 * findOne(@Param() { id }: UuidParamDto) { ... }
 */
export class UuidParamDto {
  @IsUUID('4', { message: 'id must be a valid UUID v4' })
  id!: string;
}
