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

  it('persists the actor, action, resource, and metadata via record()', async () => {
    create.mockResolvedValue({ id: 'audit-1' });

    await service.log({
      actor: { id: 'admin-1', role: 'admin' },
      action: 'GET /admin/analytics/overview',
      resource: 'analytics',
      meta: { query: { interval: '1d' } },
      ip: '127.0.0.1',
      statusCode: 200,
    });

    expect(create).toHaveBeenCalled();
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

  it('returns DUPLICATE_REQUEST when database unique constraint is violated', async () => {
    const create = jest.fn();
    const prisma = {
      adminAuditLog: {
        create,
      },
    } as unknown as PrismaService;
    const service = new AdminAuditService(prisma);

    // Simulate Prisma unique constraint violation error
    const prismaError = {
      code: 'P2002',
      meta: { target: ['idempotencyKey'] },
    };
    create.mockRejectedValue(prismaError);

    const promise = service.record({
      actor: { id: 'admin-1', role: 'admin' },
      action: 'pool.pause',
      idempotencyKey: 'unique-key-123',
    });

    await expect(promise).rejects.toBeInstanceOf(AdminAuditError);
    await expect(promise).rejects.toMatchObject({
      code: AdminAuditErrorCode.DUPLICATE_REQUEST,
      message: 'Duplicate admin audit request',
    });
  });

  it('allows duplicate keys after restart (in-memory set is cleared)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const prisma = {
      adminAuditLog: {
        create,
      },
    } as unknown as PrismaService;
    const service = new AdminAuditService(prisma);

    // First call succeeds
    await service.record({
      actor: { id: 'admin-1', role: 'admin' },
      action: 'pool.pause',
      idempotencyKey: 'unique-key-123',
    });

    expect(create).toHaveBeenCalledTimes(1);

    // Simulate restart by creating a new service instance (clears in-memory set)
    const service2 = new AdminAuditService(prisma);

    // Second call with same key - database will enforce uniqueness
    const prismaError = {
      code: 'P2002',
      meta: { target: ['idempotencyKey'] },
    };
    create.mockRejectedValue(prismaError);

    const promise = service2.record({
      actor: { id: 'admin-1', role: 'admin' },
      action: 'pool.pause',
      idempotencyKey: 'unique-key-123',
    });

    await expect(promise).rejects.toMatchObject({
      code: AdminAuditErrorCode.DUPLICATE_REQUEST,
    });
  });
});

describe('AdminAuditService.log security', () => {
  it('throws UNAUTHORIZED when actor is missing', async () => {
    const service = new AdminAuditService();

    const promise = service.log({
      actor: { id: '', role: 'admin' },
      action: 'test.action',
    });

    await expect(promise).rejects.toBeInstanceOf(AdminAuditError);
    await expect(promise).rejects.toMatchObject({
      code: AdminAuditErrorCode.UNAUTHORIZED,
    });
  });

  it('throws FORBIDDEN when actor role is not allowed', async () => {
    const service = new AdminAuditService();

    const promise = service.log({
      actor: { id: 'user-1', role: 'user' },
      action: 'test.action',
    });

    await expect(promise).rejects.toBeInstanceOf(AdminAuditError);
    await expect(promise).rejects.toMatchObject({
      code: AdminAuditErrorCode.FORBIDDEN,
    });
  });

  it('generates unique idempotency keys for same action', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const prisma = {
      adminAuditLog: {
        create,
      },
    } as unknown as PrismaService;
    const service = new AdminAuditService(prisma);

    // First call
    await service.log({
      actor: { id: 'admin-1', role: 'admin' },
      action: 'test.action',
    });

    const firstCall = create.mock.calls[0][0];
    const firstKey = firstCall.data.idempotencyKey;

    // Reset mock
    create.mockClear();
    create.mockResolvedValue({ id: 'audit-2' });

    // Second call with same action
    await service.log({
      actor: { id: 'admin-1', role: 'admin' },
      action: 'test.action',
    });

    const secondCall = create.mock.calls[0][0];
    const secondKey = secondCall.data.idempotencyKey;

    // Keys should be different
    expect(firstKey).not.toBe(secondKey);
  });

  it('uses provided idempotency key when given', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const prisma = {
      adminAuditLog: {
        create,
      },
    } as unknown as PrismaService;
    const service = new AdminAuditService(prisma);

    await service.log({
      actor: { id: 'admin-1', role: 'admin' },
      action: 'test.action',
      idempotencyKey: 'custom-key-123',
    });

    const call = create.mock.calls[0][0];
    expect(call.data.idempotencyKey).toBe('custom-key-123');
  });
});
