import {
  apiStrategySummary,
  resolveApiStrategyConfig,
} from './api-strategy.config';

describe('resolveApiStrategyConfig', () => {
  it('defaults to the canonical REST v1 API', () => {
    expect(resolveApiStrategyConfig({})).toEqual({
      apiVersion: 'v1',
      transport: 'rest',
    });
  });

  it.each(['true', '1', 'yes', 'on'])(
    'fails closed when a tRPC transport is enabled (%s)',
    (value) => {
      expect(() =>
        resolveApiStrategyConfig({ API_TRPC_ENABLED: value }),
      ).toThrow('GraphQL and tRPC are disabled');
    },
  );

  it('fails closed when a GraphQL transport is enabled', () => {
    expect(() =>
      resolveApiStrategyConfig({ API_GRAPHQL_ENABLED: 'true' }),
    ).toThrow('GraphQL and tRPC are disabled');
  });

  it('rejects unsupported transport or version settings', () => {
    expect(() => resolveApiStrategyConfig({ API_TRANSPORT: 'trpc' })).toThrow(
      'API_TRANSPORT must be rest',
    );
    expect(() => resolveApiStrategyConfig({ API_VERSION: 'v2' })).toThrow(
      'API_VERSION must be v1',
    );
  });

  it('logs an ops-safe strategy summary', () => {
    expect(apiStrategySummary(resolveApiStrategyConfig({}))).toBe(
      'version=v1 transport=rest',
    );
  });
});
