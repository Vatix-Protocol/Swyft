import { AdminAuditService } from './admin-audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminAuditService', () => {
  const create = jest.fn();
  const findMany = jest.fn();
  const prisma = {
    adminAuditLog: { create, findMany },
  } as unknown as PrismaService;
  const service = new AdminAuditService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists the actor, action, resource, and metadata', async () => {
    create.mockResolvedValue({ id: 'audit-1' });

    await service.log({
      actor: 'admin-key-fingerprint',
      action: 'GET /admin/analytics/overview',
      resource: 'analytics',
      meta: { query: { interval: '1d' } },
      ip: '127.0.0.1',
      statusCode: 200,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actor: 'admin-key-fingerprint',
        action: 'GET /admin/analytics/overview',
        resource: 'analytics',
        meta: JSON.stringify({ query: { interval: '1d' } }),
        ip: '127.0.0.1',
        statusCode: 200,
      },
    });
  });

  it('provides a bounded, newest-first audit query path', async () => {
    findMany.mockResolvedValue([]);

    await service.findRecent(1000, 25);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        take: 500,
        skip: 25,
      }),
    );
  });
});
