import { UnauthorizedException } from '@nestjs/common';

// IndexerMonitorService pulls in Stellar RPC config; the controller only
// needs it as a DI token here.
jest.mock('./indexer-monitor.service', () => ({ IndexerMonitorService: class {} }));

import { MetricsController } from './metrics.controller';
import { internalKeyAuthOutcomes } from '../admin/internal-key-ring';

describe('MetricsController internal key + /metrics/security', () => {
  const KEYS = [
    'INTERNAL_API_KEY',
    'INTERNAL_API_KEY_PREVIOUS',
    'INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT',
  ];
  const saved: Record<string, string | undefined> = {};
  const controller = new MetricsController(
    { snapshot: () => ({ ok: true }) } as any,
    { getMetrics: async () => ({ lag: 0 }) } as any,
  );

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    internalKeyAuthOutcomes.reset();
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('fails closed when INTERNAL_API_KEY is unset', () => {
    expect(() => controller.getSecurityMetrics('anything')).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts the previous key during rotation and reports bounded counters', async () => {
    process.env.INTERNAL_API_KEY = 'new';
    process.env.INTERNAL_API_KEY_PREVIOUS = 'old';
    process.env.INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT = new Date(
      Date.now() + 60_000,
    ).toISOString();

    await expect(controller.getDbMetrics('old')).resolves.toEqual({ ok: true });
    await expect(controller.getIndexerMetrics('wrong')).rejects.toThrow(
      UnauthorizedException,
    );

    const body = controller.getSecurityMetrics('new');
    expect(body.internalKeyAuth['metrics:previous']).toBe(1);
    expect(body.internalKeyAuth['metrics:invalid']).toBe(1);
    expect(body.internalKeyAuth['metrics:current']).toBe(1);
    expect(body).toHaveProperty('currentWallet.allowed');
    expect(body).toHaveProperty('analyticsScheduler.state');
    expect(JSON.stringify(body)).not.toMatch(/"(new|old)"/);
  });
});
