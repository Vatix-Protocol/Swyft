import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { InternalKeyGuard } from './internal-key.guard';
import { INTERNAL_KEY_METADATA } from './internal-key.decorator';

/**
 * Unit coverage for the admin analytics surface (#985).
 *
 * Invariants under test:
 *  - Deny-by-default: privileged analytics endpoints are unreachable without a
 *    valid internal key (missing / wrong / expired).
 *  - Stable error codes + correlation ids are surfaced to callers.
 *  - Idempotent reads: replayed requests return the same payload.
 *  - Fail-closed: dependency outages surface as 503, never partial data.
 */
describe('AnalyticsController (admin analytics + InternalKeyGuard)', () => {
  let controller: AnalyticsController;
  let service: jest.Mocked<AnalyticsService>;
  let guard: InternalKeyGuard;

  const validKey = 'internal-test-key';

  const makeContext = (headers: Record<string, string> = {}): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ headers, correlationId: headers['x-correlation-id'] }),
      }),
    } as unknown as ExecutionContext);

  beforeEach(async () => {
    process.env.INTERNAL_API_KEY = validKey;

    const moduleRef = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        InternalKeyGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn((key: string) =>
              key === INTERNAL_KEY_METADATA ? true : undefined,
            ),
          },
        },
        {
          provide: AnalyticsService,
          useValue: {
            getOverview: jest.fn(),
            getVolume: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(AnalyticsController);
    service = moduleRef.get(AnalyticsService);
    guard = moduleRef.get(InternalKeyGuard);
  });

  afterEach(() => {
    delete process.env.INTERNAL_API_KEY;
    jest.clearAllMocks();
  });

  describe('InternalKeyGuard authz negatives', () => {
    it('rejects requests with no internal key', () => {
      expect(() => guard.canActivate(makeContext())).toThrow(UnauthorizedException);
    });

    it('rejects requests with a wrong internal key', () => {
      expect(() =>
        guard.canActivate(makeContext({ 'x-internal-key': 'nope' })),
      ).toThrow(UnauthorizedException);
    });

    it('rejects expired internal keys', () => {
      const expired = Buffer.from(
        JSON.stringify({ key: validKey, exp: Date.now() - 1000 }),
      ).toString('base64');
      expect(() =>
        guard.canActivate(makeContext({ 'x-internal-key': expired })),
      ).toThrow(UnauthorizedException);
    });

    it('allows requests carrying the valid internal key', () => {
      expect(
        guard.canActivate(makeContext({ 'x-internal-key': validKey })),
      ).toBe(true);
    });

    it('denies by default when the endpoint is not marked internal', () => {
      const reflector = { getAllAndOverride: jest.fn(() => false) } as unknown as Reflector;
      const strictGuard = new InternalKeyGuard(reflector);
      expect(() => strictGuard.canActivate(makeContext())).toThrow(ForbiddenException);
    });
  });

  describe('analytics reads', () => {
    it('returns the overview payload with a correlation id', async () => {
      service.getOverview.mockResolvedValue({ totalVolume: '100', trades: 5 });

      const result = await controller.getOverview({
        correlationId: 'corr-1',
      } as never);

      expect(result).toEqual({
        data: { totalVolume: '100', trades: 5 },
        correlationId: 'corr-1',
      });
    });

    it('is idempotent for replayed requests', async () => {
      service.getVolume.mockResolvedValue({ volume: '42' });

      const first = await controller.getVolume({ correlationId: 'corr-2' } as never);
      const second = await controller.getVolume({ correlationId: 'corr-2' } as never);

      expect(first).toEqual(second);
      expect(service.getVolume).toHaveBeenCalledTimes(2);
    });

    it('fails closed with a stable error code on dependency outage', async () => {
      service.getOverview.mockRejectedValue(new Error('redis unavailable'));

      await expect(
        controller.getOverview({ correlationId: 'corr-3' } as never),
      ).rejects.toMatchObject({ code: 'ANALYTICS_UNAVAILABLE' });
    });
  });
});
