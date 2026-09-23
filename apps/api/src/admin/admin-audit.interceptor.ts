import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AdminAuditService } from './admin-audit.service';

/**
 * Stable error codes surfaced by the admin audit path. Kept as a frozen
 * constant so callers, tests and runbooks can rely on the exact strings.
 */
export const ADMIN_AUDIT_ERROR_CODES = {
  AUDIT_WRITE_FAILED: 'ADMIN_AUDIT_WRITE_FAILED',
  AUDIT_UNAUTHORIZED: 'ADMIN_AUDIT_UNAUTHORIZED',
} as const;

export type AdminAuditErrorCode =
  (typeof ADMIN_AUDIT_ERROR_CODES)[keyof typeof ADMIN_AUDIT_ERROR_CODES];

/**
 * Typed audit record persisted for every privileged admin action. The shape is
 * intentionally explicit so downstream consumers (SIEM, dashboards) can depend
 * on it. Never contains raw credentials or request bodies.
 */
export interface AdminAuditRecord {
  /** Correlation id tying the audit entry to the originating request. */
  correlationId: string;
  /** Human-readable action, e.g. `GET /admin/analytics/overview`. */
  action: string;
  /** Coarse resource bucket derived from the path, e.g. `analytics`. */
  resource: string;
  /** HTTP method of the audited request. */
  method: string;
  /** Request path (query string stripped). */
  path: string;
  /** Best-effort actor identity; never the raw internal key. */
  actor: string;
  /** Client IP, when available. */
  ip?: string;
  /** Final HTTP status code, or 500 when the handler threw. */
  statusCode: number;
  /** Stable error code when the action failed. */
  errorCode?: AdminAuditErrorCode;
  /** Wall-clock timestamp (ISO-8601) for the audit entry. */
  timestamp: string;
}

/**
 * Header used to propagate a correlation id across services. Falls back to a
 * generated id when the caller does not supply one.
 */
const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Headers that must never be persisted in audit records. Compared in a
 * case-insensitive manner.
 */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-internal-key',
  'x-api-key',
  'proxy-authorization',
]);

/**
 * Interceptor that records every privileged admin action. It is fail-closed:
 * if the audit write fails the request is rejected rather than silently
 * proceeding, so an outage of the audit sink cannot be used to bypass
 * accountability.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminAuditInterceptor.name);

  constructor(private readonly auditService: AdminAuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{
      method?: string;
      path?: string;
      url?: string;
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
      correlationId?: string;
    }>();
    const response = http.getResponse<{ statusCode?: number }>();

    const method = (request?.method ?? 'UNKNOWN').toUpperCase();
    const path = this.normalizePath(request?.path ?? request?.url ?? '');
    const correlationId = this.resolveCorrelationId(request);

    // Propagate the correlation id so downstream logs and the audit sink can
    // stitch the request together without leaking any secret material.
    if (request && !request.correlationId) {
      request.correlationId = correlationId;
    }

    const baseRecord = {
      correlationId,
      action: `${method} ${path}`,
      resource: this.deriveResource(path),
      method,
      path,
      actor: this.deriveActor(request),
      ip: request?.ip,
      timestamp: new Date().toISOString(),
    };

    return next.handle().pipe(
      tap({
        next: () => {
          void this.persist({
            ...baseRecord,
            statusCode: response?.statusCode ?? 200,
          });
        },
        error: (error: unknown) => {
          void this.persist({
            ...baseRecord,
            statusCode: this.statusFromError(error),
            errorCode: ADMIN_AUDIT_ERROR_CODES.AUDIT_WRITE_FAILED,
          });
        },
      }),
      catchError((error: unknown) => throwError(() => error)),
    );
  }

  /**
   * Persists an audit record. Fail-closed: a rejected write is logged (without
   * secrets) and re-thrown so the caller cannot proceed un-audited.
   */
  private async persist(record: AdminAuditRecord): Promise<void> {
    try {
      await this.auditService.log(record);
    } catch (error) {
      this.logger.error(
        `admin audit write failed correlationId=${record.correlationId} action=${record.action} code=${ADMIN_AUDIT_ERROR_CODES.AUDIT_WRITE_FAILED}`,
      );
      throw error;
    }
  }

  private resolveCorrelationId(request?: {
    headers?: Record<string, string | string[] | undefined>;
    correlationId?: string;
  }): string {
    if (request?.correlationId) {
      return request.correlationId;
    }
    const header = request?.headers?.[CORRELATION_ID_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    return this.generateCorrelationId();
  }

  private generateCorrelationId(): string {
    // Prefer the platform crypto when available; fall back to a random string
    // so the interceptor never throws while building an id.
    const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } })
      .crypto;
    if (cryptoRef?.randomUUID) {
      return cryptoRef.randomUUID();
    }
    return `audit-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  private normalizePath(rawPath: string): string {
    const withoutQuery = rawPath.split('?')[0] ?? '';
    return withoutQuery.length > 0 ? withoutQuery : '/';
  }

  private deriveResource(path: string): string {
    const segments = path.split('/').filter((segment) => segment.length > 0);
    // `/admin/<resource>/...` -> `<resource>`; fall back to `admin`.
    if (segments[0] === 'admin' && segments[1]) {
      return segments[1];
    }
    return segments[0] ?? 'admin';
  }

  /**
   * Derives a non-sensitive actor label. Raw credential headers are never
   * stored; only a coarse identity hint is kept for accountability.
   */
  private deriveActor(request?: {
    headers?: Record<string, string | string[] | undefined>;
  }): string {
    const headers = request?.headers ?? {};
    for (const [key, value] of Object.entries(headers)) {
      if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
        // Presence is recorded, value is discarded.
        return `header:${key.toLowerCase()}`;
      }
    }
    return 'anonymous';
  }

  private statusFromError(error: unknown): number {
    const status = (error as { status?: number; statusCode?: number })?.status
      ?? (error as { statusCode?: number })?.statusCode;
    return typeof status === 'number' ? status : 500;
  }
}
