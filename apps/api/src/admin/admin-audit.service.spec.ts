import {
  AdminAuditError,
  AdminAuditErrorCode,
  AdminAuditService,
} from './admin-audit.service';
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

  it('caps a limit of 1000 at take 500', async () => {
    findMany.mockResolvedValue([]);

    await service.findRecent(1000);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
  });

  it('raises a limit of 0 to take 1', async () => {
    findMany.mockResolvedValue([]);

    await service.findRecent(0);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
  });

  it('returns an empty list without querying when prisma is missing', async () => {
    await expect(new AdminAuditService().findRecent(1000)).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('AdminAuditService.record idempotency key validation', () => {
  it.each(['', undefined, 42])(
    'rejects idempotency key %p with INVALID_INPUT and writes no row',
    async (idempotencyKey) => {
      const service = new AdminAuditService();
      const persist = jest.spyOn(
        service as unknown as { persist: () => Promise<void> },
        'persist',
      );

      const promise = service.record({
        actor: { id: 'admin-1', role: 'admin' },
        action: 'pool.pause',
        idempotencyKey: idempotencyKey as unknown as string,
      });

      await expect(promise).rejects.toBeInstanceOf(AdminAuditError);
      await expect(promise).rejects.toMatchObject({
        code: AdminAuditErrorCode.INVALID_INPUT,
        message: 'Missing idempotency key',
      });
      expect(persist).not.toHaveBeenCalled();
      expect(service.list()).toHaveLength(0);
    },
  );
});
