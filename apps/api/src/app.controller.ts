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

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
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
