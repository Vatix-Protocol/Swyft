import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { AdminAuditInterceptor } from './admin-audit.interceptor';
import { AdminAuditService } from './admin-audit.service';

describe('AdminAuditInterceptor', () => {
  it('audits a successful privileged action without storing the raw key', async () => {
    const auditService = { log: jest.fn().mockResolvedValue(undefined) };
    const request = {
      method: 'GET',
      path: '/admin/analytics/overview',
      query: {},
      ip: '127.0.0.1',
      headers: { 'x-internal-key': 'do-not-store-me' },
    };
    const response = { statusCode: 200 };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of({ ok: true }) } as CallHandler;

    await lastValueFrom(
      new AdminAuditInterceptor(
        auditService as unknown as AdminAuditService,
      ).intercept(context, next),
    );
    await Promise.resolve();

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GET /admin/analytics/overview',
        resource: 'analytics',
        statusCode: 200,
      }),
    );
    expect(auditService.log.mock.calls[0][0].actor).not.toContain(
      'do-not-store-me',
    );
  });
});
