import { context, trace } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';

// Registered once, before any call to initTracing(), so it wins the global
// tracer provider slot. This keeps span creation deterministic and fully
// in-process (no OTLP network export) for the "active span" assertions below.
trace.setGlobalTracerProvider(new BasicTracerProvider());

describe('tracing', () => {
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
    process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
  });

  describe('initTracing', () => {
    it('does nothing when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      const { initTracing, shutdownTracing } = await import('./tracing');

      expect(() => initTracing()).not.toThrow();
      await expect(shutdownTracing()).resolves.toBeUndefined();
    });

    it('does nothing in the test environment even if an endpoint is set', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
        'http://localhost:4318/v1/traces';
      process.env.NODE_ENV = 'test';
      const { initTracing, shutdownTracing } = await import('./tracing');

      expect(() => initTracing()).not.toThrow();
      await expect(shutdownTracing()).resolves.toBeUndefined();
    });

    it('never throws even if SDK registration fails outside the test env', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
        'http://localhost:4318/v1/traces';
      process.env.NODE_ENV = 'production';
      const { initTracing, shutdownTracing } = await import('./tracing');

      // A competing global provider (testProvider, above) is already
      // registered, so the SDK's own registration is a no-op — this must
      // not surface as a thrown error either way.
      expect(() => initTracing()).not.toThrow();
      await expect(shutdownTracing()).resolves.toBeUndefined();
    });
  });

  describe('getActiveTraceIds', () => {
    it('returns null when there is no active span', async () => {
      const { getActiveTraceIds } = await import('./tracing');
      expect(getActiveTraceIds()).toBeNull();
    });

    it('returns the trace/span IDs of the currently active span', async () => {
      const { getActiveTraceIds } = await import('./tracing');

      const span = trace.getTracer('test').startSpan('unit-test-span');
      const ctxWithSpan = trace.setSpan(context.active(), span);

      context.with(ctxWithSpan, () => {
        const ids = getActiveTraceIds();
        expect(ids).toEqual({
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
        });
      });

      span.end();
    });
  });
});
