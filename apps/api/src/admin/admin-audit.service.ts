import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AdminAuditEntry {
  actor: string;
  action: string;
  resource: string;
  meta?: Record<string, unknown>;
  ip?: string;
  statusCode?: number;
}

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist an immutable audit entry for an admin API action.
   * Failures are caught and logged so they never interrupt the request.
   */
  async log(entry: AdminAuditEntry): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          actor: entry.actor,
          action: entry.action,
          resource: entry.resource,
          meta: JSON.stringify(entry.meta ?? {}),
          ip: entry.ip ?? null,
          statusCode: entry.statusCode ?? null,
        },
      });
    } catch (err) {
      // Audit logging must never break the request.
      this.logger.error('Failed to write admin audit log', err);
    }
  }

  /**
   * Retrieve recent audit log entries. Used by the /admin/audit endpoint.
   */
  async findRecent(limit = 100, offset = 0) {
    return this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
      skip: offset,
      select: {
        id: true,
        actor: true,
        action: true,
        resource: true,
        meta: true,
        ip: true,
        statusCode: true,
        createdAt: true,
      },
    });
  }
}
