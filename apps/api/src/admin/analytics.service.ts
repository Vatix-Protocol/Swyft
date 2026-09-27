import { Injectable, Logger } from '@nestjs/common';

/**
 * Stable error codes for TWAP window configuration validation.
 * Fail-closed: any invalid or missing configuration is rejected.
 */
export const TWAP_WINDOW_ERRORS = {
  INVALID_WINDOW: 'TWAP_WINDOW_INVALID',
  WINDOW_OUT_OF_BOUNDS: 'TWAP_WINDOW_OUT_OF_BOUNDS',
  INVALID_INTERVAL: 'TWAP_WINDOW_INVALID_INTERVAL',
  INTERVAL_EXCEEDS_WINDOW: 'TWAP_WINDOW_INTERVAL_EXCEEDS_WINDOW',
  UNAUTHORIZED: 'TWAP_WINDOW_UNAUTHORIZED',
  REPLAY_DETECTED: 'TWAP_WINDOW_REPLAY_DETECTED',
  DEPENDENCY_UNAVAILABLE: 'TWAP_WINDOW_DEPENDENCY_UNAVAILABLE',
} as const;

export type TwapWindowErrorCode =
  (typeof TWAP_WINDOW_ERRORS)[keyof typeof TWAP_WINDOW_ERRORS];

/**
 * Hard bounds for TWAP window configuration.
 * These are the source of truth for the money path and must not be bypassed
 * by untrusted clients.
 */
export const TWAP_WINDOW_BOUNDS = {
  MIN_WINDOW_SECONDS: 60,
  MAX_WINDOW_SECONDS: 86_400,
  MIN_INTERVAL_SECONDS: 1,
  MAX_INTERVAL_SECONDS: 3_600,
} as const;

export interface TwapWindowConfig {
  windowSeconds: number;
  intervalSeconds: number;
}

export interface TwapWindowConfigRequest extends TwapWindowConfig {
  /** Idempotency key supplied by the caller to guard against replays. */
  idempotencyKey: string;
  /** Role of the caller; only privileged roles may mutate config. */
  role?: string;
}

export interface TwapWindowConfigResult {
  ok: boolean;
  config?: TwapWindowConfig;
  errorCode?: TwapWindowErrorCode;
  correlationId: string;
}

const PRIVILEGED_ROLES = new Set(['admin', 'operator']);

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  /** In-memory idempotency ledger keyed by idempotency key. */
  private readonly processedKeys = new Map<string, TwapWindowConfigResult>();

  /** Last accepted configuration; undefined until a valid config is set. */
  private twapWindowConfig?: TwapWindowConfig;

  /**
   * Validate and apply a TWAP window configuration.
   *
   * Fail-closed: rejects on missing/invalid input, out-of-bounds values,
   * unauthorized roles, replayed idempotency keys, and dependency outages.
   */
  configureTwapWindow(
    request: TwapWindowConfigRequest,
    correlationId: string = this.newCorrelationId(),
  ): TwapWindowConfigResult {
    // Deny-by-default: only privileged roles may mutate TWAP window config.
    if (!request.role || !PRIVILEGED_ROLES.has(request.role)) {
      this.logReject(correlationId, TWAP_WINDOW_ERRORS.UNAUTHORIZED);
      return this.fail(TWAP_WINDOW_ERRORS.UNAUTHORIZED, correlationId);
    }

    // Idempotency: reject replayed requests with the same key.
    if (!request.idempotencyKey || typeof request.idempotencyKey !== 'string') {
      this.logReject(correlationId, TWAP_WINDOW_ERRORS.INVALID_WINDOW);
      return this.fail(TWAP_WINDOW_ERRORS.INVALID_WINDOW, correlationId);
    }
    const prior = this.processedKeys.get(request.idempotencyKey);
    if (prior) {
      this.logReject(correlationId, TWAP_WINDOW_ERRORS.REPLAY_DETECTED);
      return this.fail(TWAP_WINDOW_ERRORS.REPLAY_DETECTED, correlationId);
    }

    const validation = this.validateBounds(request);
    if (!validation.ok) {
      this.logReject(correlationId, validation.errorCode!);
      return this.fail(validation.errorCode!, correlationId);
    }

    const config: TwapWindowConfig = {
      windowSeconds: request.windowSeconds,
      intervalSeconds: request.intervalSeconds,
    };

    // Persist only after validation succeeds (fail-closed on writes).
    try {
      this.twapWindowConfig = config;
    } catch (err) {
      this.logger.error(
        `twap_window.persist_failed correlationId=${correlationId}`,
      );
      return this.fail(TWAP_WINDOW_ERRORS.DEPENDENCY_UNAVAILABLE, correlationId);
    }

    const result: TwapWindowConfigResult = {
      ok: true,
      config,
      correlationId,
    };
    this.processedKeys.set(request.idempotencyKey, result);

    // Ops-safe metrics/logs: no secrets, only bounded numeric values.
    this.logger.log(
      `twap_window.configured correlationId=${correlationId} ` +
        `windowSeconds=${config.windowSeconds} intervalSeconds=${config.intervalSeconds}`,
    );
    return result;
  }

  /** Returns the active TWAP window config, if any. */
  getTwapWindowConfig(): TwapWindowConfig | undefined {
    return this.twapWindowConfig;
  }

  /**
   * Enforce TWAP window bounds. Returns a stable error code on failure.
   */
  private validateBounds(
    request: TwapWindowConfig,
  ): { ok: boolean; errorCode?: TwapWindowErrorCode } {
    const { windowSeconds, intervalSeconds } = request;

    if (
      !Number.isFinite(windowSeconds) ||
      !Number.isInteger(windowSeconds) ||
      windowSeconds <= 0
    ) {
      return { ok: false, errorCode: TWAP_WINDOW_ERRORS.INVALID_WINDOW };
    }
    if (
      windowSeconds < TWAP_WINDOW_BOUNDS.MIN_WINDOW_SECONDS ||
      windowSeconds > TWAP_WINDOW_BOUNDS.MAX_WINDOW_SECONDS
    ) {
      return { ok: false, errorCode: TWAP_WINDOW_ERRORS.WINDOW_OUT_OF_BOUNDS };
    }

    if (
      !Number.isFinite(intervalSeconds) ||
      !Number.isInteger(intervalSeconds) ||
      intervalSeconds <= 0
    ) {
      return { ok: false, errorCode: TWAP_WINDOW_ERRORS.INVALID_INTERVAL };
    }
    if (
      intervalSeconds < TWAP_WINDOW_BOUNDS.MIN_INTERVAL_SECONDS ||
      intervalSeconds > TWAP_WINDOW_BOUNDS.MAX_INTERVAL_SECONDS
    ) {
      return { ok: false, errorCode: TWAP_WINDOW_ERRORS.INVALID_INTERVAL };
    }
    if (intervalSeconds > windowSeconds) {
      return {
        ok: false,
        errorCode: TWAP_WINDOW_ERRORS.INTERVAL_EXCEEDS_WINDOW,
      };
    }

    return { ok: true };
  }

  private fail(
    errorCode: TwapWindowErrorCode,
    correlationId: string,
  ): TwapWindowConfigResult {
    return { ok: false, errorCode, correlationId };
  }

  private logReject(correlationId: string, errorCode: TwapWindowErrorCode): void {
    this.logger.warn(
      `twap_window.rejected correlationId=${correlationId} errorCode=${errorCode}`,
    );
  }

  private newCorrelationId(): string {
    return `twap-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}
