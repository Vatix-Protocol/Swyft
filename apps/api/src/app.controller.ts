import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService, ApiIndex } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Public API index. Replaces the Nest scaffold "Hello World!" string with
   * a minimal, versioned pointer to the real API surface (/v1/*, /docs,
   * /health) so callers hitting the bare root get something useful instead
   * of a placeholder.
   */
  @Get()
  getIndex(): ApiIndex {
    return this.appService.getIndex();
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
