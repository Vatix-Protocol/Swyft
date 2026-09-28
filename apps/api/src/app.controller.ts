import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * Stable error codes for the Swyft router surface.
 *
 * Multi-hop routing decision (issue #1021):
 *   Swyft's router is an EXPLICIT NON-GOAL for multi-hop swaps.
 *   Only single-hop routes are supported. Multi-hop requests are
 *   rejected fail-closed (deny-by-default) with a stable error code
 *   so untrusted clients cannot silently degrade into an unsupported
 *   execution path. See CONTRACTS.md and docs/ROADMAP.md.
 */
export const ROUTER_ERROR_CODES = {
  MULTI_HOP_NOT_SUPPORTED: 'ROUTER_MULTI_HOP_NOT_SUPPORTED',
  INVALID_ROUTE: 'ROUTER_INVALID_ROUTE',
} as const;

export type RouterErrorCode =
  (typeof ROUTER_ERROR_CODES)[keyof typeof ROUTER_ERROR_CODES];

/**
 * Typed router capability descriptor. This is the future-proof interface:
 * if multi-hop ever becomes a goal, `multiHop` flips to true and the
 * rejection path below is replaced by a real implementation without
 * changing the wire contract.
 */
export interface RouterCapabilities {
  readonly multiHop: false;
  readonly maxHops: 1;
  readonly errorCode: RouterErrorCode;
}

export const ROUTER_CAPABILITIES: RouterCapabilities = {
  multiHop: false,
  maxHops: 1,
  errorCode: ROUTER_ERROR_CODES.MULTI_HOP_NOT_SUPPORTED,
};

/**
 * Fail-closed guard for the multi-hop policy. Returns a stable error
 * payload when a request asks for more than one hop, otherwise null.
 * `correlationId` is echoed back so ops can trace rejected requests
 * without leaking any secret material.
 */
export function rejectMultiHop(
  hops: number | undefined,
  correlationId?: string,
): { code: RouterErrorCode; message: string; correlationId?: string } | null {
  if (hops === undefined || hops <= 1) {
    return null;
  }
  return {
    code: ROUTER_ERROR_CODES.MULTI_HOP_NOT_SUPPORTED,
    message:
      'Multi-hop routing is an explicit non-goal for Swyft; only single-hop routes are supported.',
    correlationId,
  };
}

/**
 * Stable error codes for the API health surface (issue #1081).
 *
 * Liveness and readiness are deliberately separate:
 *   - /health       -> liveness, dependency-free, always 200 while the
 *                      process is up. Never touches DB/Redis/RPC.
 *   - /health/ready -> readiness, fail-closed. Returns non-2xx with a
 *                      stable code when any critical dependency is
 *                      unavailable, so orchestrators stop routing
 *                      traffic (and writes) to a degraded instance.
 */
export const HEALTH_ERROR_CODES = {
  NOT_READY: 'API_NOT_READY',
  DEPENDENCY_UNAVAILABLE: 'API_DEPENDENCY_UNAVAILABLE',
} as const;

export type HealthErrorCode =
  (typeof HEALTH_ERROR_CODES)[keyof typeof HEALTH_ERROR_CODES];

/** Critical dependencies whose availability gates readiness. */
export type HealthDependency = 'db' | 'redis' | 'rpc';

export interface LivenessResponse {
  readonly status: 'ok';
  readonly service: 'swyft-api';
}

export interface ReadinessResponse {
  readonly status: 'ready' | 'not_ready';
  readonly service: 'swyft-api';
  readonly dependencies: Readonly<Record<HealthDependency, 'up' | 'down'>>;
  readonly errorCode?: HealthErrorCode;
  readonly correlationId?: string;
}

/**
 * Readiness probe contract. Implementations MUST fail-closed: any thrown
 * error or false result marks the dependency down. No connection strings,
 * hostnames, or credentials are ever surfaced in the response.
 */
export interface HealthProbe {
  check(dependency: HealthDependency): Promise<boolean>;
}

const CRITICAL_DEPENDENCIES: readonly HealthDependency[] = [
  'db',
  'redis',
  'rpc',
];

/**
 * Evaluates readiness across all critical dependencies. Fail-closed:
 * a probe that throws is treated as down, and any down dependency makes
 * the whole instance not ready. Returns a typed, secret-free payload.
 */
export async function evaluateReadiness(
  probe: HealthProbe,
  correlationId?: string,
): Promise<ReadinessResponse> {
  const dependencies = {} as Record<HealthDependency, 'up' | 'down'>;
  let allUp = true;

  for (const dependency of CRITICAL_DEPENDENCIES) {
    let up = false;
    try {
      up = await probe.check(dependency);
    } catch {
      up = false;
    }
    dependencies[dependency] = up ? 'up' : 'down';
    if (!up) {
      allUp = false;
    }
  }

  if (allUp) {
    return {
      status: 'ready',
      service: 'swyft-api',
      dependencies,
      correlationId,
    };
  }

  return {
    status: 'not_ready',
    service: 'swyft-api',
    dependencies,
    errorCode: HEALTH_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
    correlationId,
  };
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Liveness probe. Dependency-free by design: it only asserts the
   * process is running so a slow DB/Redis/RPC never triggers a restart
   * loop. Readiness is reported separately at /health/ready.
   */
  @Get('health')
  getLiveness(): LivenessResponse {
    return { status: 'ok', service: 'swyft-api' };
  }

  /**
   * Readiness probe. Fail-closed: returns non-2xx with a stable error
   * code when any critical dependency is unavailable, so orchestrators
   * stop sending traffic (including writes) to a degraded instance.
   * The response never leaks secrets, connection strings, or hostnames.
   */
  @Get('health/ready')
  async getReadiness(
    @Query('correlationId') correlationId?: string,
  ): Promise<ReadinessResponse> {
    const probe = this.appService.getHealthProbe();
    const result = await evaluateReadiness(probe, correlationId);
    if (result.status !== 'ready') {
      throw new ServiceUnavailableException({
        code: result.errorCode ?? HEALTH_ERROR_CODES.NOT_READY,
        message: 'API is not ready: one or more critical dependencies are unavailable.',
        dependencies: result.dependencies,
        correlationId,
      });
    }
    return result;
  }

  /**
   * Router capability probe. Advertises the explicit multi-hop decision
   * so clients and Stellar Wave contributors have a single source of truth.
   */
  @Get('router/capabilities')
  getRouterCapabilities(): RouterCapabilities {
    return ROUTER_CAPABILITIES;
  }

  /**
   * Router route validation entrypoint. Deny-by-default: any request with
   * more than one hop is rejected with a stable error code. Authz is
   * enforced upstream by the global guard; this handler never trusts the
   * client to self-declare a supported route.
   */
  @Get('router/validate')
  validateRoute(
    @Query('hops') hops?: string,
    @Query('correlationId') correlationId?: string,
  ): { ok: true } | { ok: false; error: ReturnType<typeof rejectMultiHop> } {
    const parsedHops = hops === undefined ? undefined : Number(hops);
    const rejection = rejectMultiHop(
      Number.isFinite(parsedHops) ? parsedHops : undefined,
      correlationId,
    );
    if (rejection) {
      return { ok: false, error: rejection };
    }
    return { ok: true };
  }
}
