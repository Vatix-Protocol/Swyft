import { Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * OpenTelemetry distributed tracing bootstrap.
 *
 * Active only when OTEL_EXPORTER_OTLP_ENDPOINT is set — every export in this
 * module is a safe no-op otherwise, so the app's behavior is unchanged when
 * tracing isn't configured (mirrors the SENTRY_DSN gate in sentry.ts).
 *
 * Registering HttpInstrumentation makes trace context propagation automatic
 * in both directions: incoming requests carrying a W3C `traceparent` header
 * are joined into the caller's trace, and outgoing http/https requests made
 * by this process (e.g. the Horizon SDK) carry the active trace onward.
 */
const logger = new Logger('Tracing');
let sdk: NodeSDK | null = null;

export function initTracing(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || process.env.NODE_ENV === 'test') return;

  try {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'swyft-api',
      }),
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
      instrumentations: [
        new HttpInstrumentation(),
        new ExpressInstrumentation(),
      ],
    });
    sdk.start();
    logger.log(`OpenTelemetry tracing started -> ${endpoint}`);

    process.on('SIGTERM', () => void shutdownTracing());
  } catch (err) {
    sdk = null;
    logger.warn(
      `OpenTelemetry init failed — tracing disabled. ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  const active = sdk;
  sdk = null;
  try {
    await active.shutdown();
  } catch {
    /* best-effort shutdown — process is exiting anyway */
  }
}

/**
 * Returns the active span's trace/span IDs, or null when tracing is disabled
 * or there is no active span. Used to correlate structured logs with traces.
 */
export function getActiveTraceIds(): {
  traceId: string;
  spanId: string;
} | null {
  const span = trace.getActiveSpan();
  if (!span) return null;

  const spanContext = span.spanContext();
  if (!trace.isSpanContextValid(spanContext)) return null;

  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}
