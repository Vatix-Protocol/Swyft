import { BoundedCounter } from '../observability/bounded-counter';

/**
 * Analytics scheduler metrics (#1031). Kept separate from the scheduler so
 * the metrics endpoint can read them without importing BullMQ or the
 * analytics service.
 *
 * Cardinality: every label is a fixed enum. Job ids, correlation ids and
 * error messages go to logs only, never into a label.
 */
export const ANALYTICS_RUN_OUTCOMES = [
  'success',
  'failure',
  'rejected_job',
] as const;

/** Mirrors ANALYTICS_ERROR_CODES plus a catch-all for foreign errors. */
export const ANALYTICS_FAILURE_REASONS = [
  'ANALYTICS_DEPENDENCY_UNAVAILABLE',
  'ANALYTICS_COMPUTATION_FAILED',
  'ANALYTICS_INVALID_INPUT',
  'UNKNOWN',
] as const;

export type AnalyticsRunOutcome = (typeof ANALYTICS_RUN_OUTCOMES)[number];
export type AnalyticsFailureReason = (typeof ANALYTICS_FAILURE_REASONS)[number];
export type AnalyticsSchedulerState =
  | 'starting'
  | 'running'
  | 'disabled'
  | 'unavailable'
  | 'stopped';

class AnalyticsSchedulerMetrics {
  readonly runs = new BoundedCounter<AnalyticsRunOutcome>(
    'analytics_scheduler_runs',
    ANALYTICS_RUN_OUTCOMES,
  );
  readonly failures = new BoundedCounter<AnalyticsFailureReason>(
    'analytics_scheduler_failures',
    ANALYTICS_FAILURE_REASONS,
  );
  state: AnalyticsSchedulerState = 'stopped';
  intervalMs: number | null = null;
  lastSuccessAt: string | null = null;
  lastDurationMs: number | null = null;

  snapshot() {
    return {
      state: this.state,
      intervalMs: this.intervalMs,
      lastSuccessAt: this.lastSuccessAt,
      lastDurationMs: this.lastDurationMs,
      runs: this.runs.snapshot(),
      failures: this.failures.snapshot(),
    };
  }

  reset(): void {
    this.runs.reset();
    this.failures.reset();
    this.state = 'stopped';
    this.intervalMs = null;
    this.lastSuccessAt = null;
    this.lastDurationMs = null;
  }
}

export const analyticsSchedulerMetrics = new AnalyticsSchedulerMetrics();

export function classifyAnalyticsFailure(err: unknown): AnalyticsFailureReason {
  const code = (err as { code?: unknown } | null)?.code;
  return (ANALYTICS_FAILURE_REASONS as readonly unknown[]).includes(code)
    ? (code as AnalyticsFailureReason)
    : 'UNKNOWN';
}
