import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerWallet: string, label: string) {
    const raw = randomBytes(32).toString('hex');
    const hashed = createHash('sha256').update(raw).digest('hex');
    await this.prisma.apiKey.create({ data: { hashedKey: hashed, label, ownerWallet } });
    return { key: raw, label };
  }

  list(ownerWallet: string) {
    return this.prisma.apiKey.findMany({
      where: { ownerWallet, revoked: false },
      select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    });
  }

  async revoke(id: string, ownerWallet: string) {
    await this.prisma.apiKey.updateMany({ where: { id, ownerWallet }, data: { revoked: true } });
  }
}
