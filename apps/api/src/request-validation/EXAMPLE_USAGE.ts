/**
 * Example: how to use the validation + error-handling infrastructure
 * in a real feature controller and service.
 *
 * This file is for reference only — do not commit as production code.
 */

// ── Example DTO (apps/api/src/users/dto/create-user.dto.ts) ──────────────────

import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: 'username should not be empty' })
  @MinLength(3, { message: 'username must be at least 3 characters' })
  @MaxLength(30, { message: 'username must be at most 30 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  username!: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;
}

// ── Example Controller (apps/api/src/users/users.controller.ts) ──────────────

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  DuplicateResourceException,
  PaginatedResponseDto,
  PaginationQueryDto,
  ResourceNotFoundException,
  UuidParamDto,
} from '../common';

// Stub guard — replace with your real JwtAuthGuard
class JwtAuthGuard {}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersServiceStub) {}

  @Post()
  async create(@Body() dto: CreateUserDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      // 409 — structured, typed, no magic strings
      throw new DuplicateResourceException('User', 'email');
    }
    return this.usersService.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    const [users, total] = await this.usersService.findAll(pagination);
    return new PaginatedResponseDto(users, total, pagination.page ?? 1, pagination.limit ?? 20);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param() { id }: UuidParamDto) {
    const user = await this.usersService.findById(id);
    if (!user) {
      // 404 — human-readable, includes the ID
      throw new ResourceNotFoundException('User', id);
    }
    return user;
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param() { id }: UuidParamDto) {
    const user = await this.usersService.findById(id);
    if (!user) throw new ResourceNotFoundException('User', id);
    return this.usersService.delete(id);
  }
}

// ── Stub service (replace with real implementation) ───────────────────────────

class UsersServiceStub {
  async findByEmail(_email: string) { return null; }
  async create(_dto: CreateUserDto) { return {}; }
  async findAll(_p: PaginationQueryDto): Promise<[unknown[], number]> { return [[], 0]; }
  async findById(_id: string) { return null; }
  async delete(_id: string) { return {}; }
}
