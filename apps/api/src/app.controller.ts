import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    const result = await this.appService.getHealth();
    res.status(
      result.status === 'degraded'
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.OK,
    );
    return result;
  }
}
