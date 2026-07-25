import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { AdminAuditService } from './admin-audit.service';
import { createHash } from 'crypto';

/**
 * Fires after every admin controller action and writes an immutable entry to
 * the admin_audit_log table. The internal API key is one-way hashed before
 * storage so the raw secret is never persisted.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AdminAuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const rawKey = req.headers['x-internal-key'] as string | undefined;
    const actor = rawKey
      ? createHash('sha256').update(rawKey).digest('hex').slice(0, 16)
      : 'unknown';

    const action = `${req.method} ${req.path}`;
    const resource = req.path.split('/').filter(Boolean)[1] ?? 'admin';

    const meta: Record<string, unknown> = {};
    if (req.query && Object.keys(req.query).length > 0) {
      meta['query'] = req.query;
    }

    return next.handle().pipe(
      tap({
        next: () => {
          void this.auditService.log({
            actor,
            action,
            resource,
            meta,
            ip: req.ip,
            statusCode: res.statusCode,
          });
        },
        error: (err: unknown) => {
          const status =
            err && typeof err === 'object' && 'status' in err
              ? (err as { status: number }).status
              : 500;
          void this.auditService.log({
            actor,
            action,
            resource,
            meta: { ...meta, error: true },
            ip: req.ip,
            statusCode: status,
          });
        },
      }),
    );
  }
}
