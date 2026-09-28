export interface ApiStrategyConfig {
  apiVersion: 'v1';
  transport: 'rest';
}

function isEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (value ?? '').trim().toLowerCase(),
  );
}

export function resolveApiStrategyConfig(
  env: Record<string, string | undefined> = process.env,
): ApiStrategyConfig {
  if (env.API_VERSION !== undefined && env.API_VERSION !== 'v1') {
    throw new Error(
      'API_VERSION must be v1; unsupported API versions are disabled',
    );
  }

  if (
    env.API_TRANSPORT !== undefined &&
    env.API_TRANSPORT.trim().toLowerCase() !== 'rest'
  ) {
    throw new Error(
      'API_TRANSPORT must be rest; GraphQL and tRPC are not enabled',
    );
  }

  if (isEnabled(env.API_TRPC_ENABLED) || isEnabled(env.API_GRAPHQL_ENABLED)) {
    throw new Error(
      'GraphQL and tRPC are disabled; REST is the only supported API transport',
    );
  }

  return { apiVersion: 'v1', transport: 'rest' };
}

export function apiStrategySummary(config: ApiStrategyConfig): string {
  return `version=${config.apiVersion} transport=${config.transport}`;
}
