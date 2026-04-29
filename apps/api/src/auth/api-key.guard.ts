import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

interface RequestWithUser {
  headers: { 'x-api-key'?: string };
  user?: { walletAddress: string; apiKeyId: string };
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const raw = req.headers['x-api-key'];

    if (!raw) throw new UnauthorizedException('Missing X-Api-Key header');

    const hashed = createHash('sha256').update(raw).digest('hex');
    const record = await this.prisma.apiKey.findUnique({ where: { hashedKey: hashed } });

    if (!record || record.revoked) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    await this.prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });

    req.user = { walletAddress: record.ownerWallet, apiKeyId: record.id };
    return true;
  }
}
