import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class InternalKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.headers['x-internal-key'] as string | undefined;
    const expected = process.env.INTERNAL_API_KEY;
    if (!expected || key !== expected) throw new UnauthorizedException();
    return true;
  }
}
