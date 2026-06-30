#!/usr/bin/env node
/**
 * #424 — Load test: GET /v1/pools at scale
 *
 * Fires N concurrent requests against GET /v1/pools (default: 100) and
 * reports p50 / p95 / p99 latencies, throughput (req/s), and error rate.
 *
 * Usage:
 *   node scripts/load-test-pools.js [concurrency] [total_requests] [base_url]
 *
 * Examples:
 *   node scripts/load-test-pools.js                        # defaults
 *   node scripts/load-test-pools.js 50 500
 *   node scripts/load-test-pools.js 20 200 http://localhost:3001
 *
 * No external dependencies — uses Node's built-in `fetch` (Node 18+).
 */

const CONCURRENCY   = parseInt(process.argv[2] ?? '10',  10);
const TOTAL         = parseInt(process.argv[3] ?? '100', 10);
const BASE_URL      = process.argv[4] ?? 'http://localhost:3001';
const ENDPOINT      = `${BASE_URL}/v1/pools`;

/** Fire a single GET request and return { ok, statusCode, durationMs }. */
async function singleRequest() {
  const start = performance.now();
  try {
    const res = await fetch(ENDPOINT);
    return { ok: res.ok, statusCode: res.status, durationMs: performance.now() - start };
  } catch {
    return { ok: false, statusCode: 0, durationMs: performance.now() - start };
  }
}

/** Run `count` requests with up to `concurrency` in-flight at once. */
async function runBatch(total, concurrency) {
  const results = [];
  let dispatched = 0;
  const inFlight = new Set();

  return new Promise((resolve) => {
    function dispatch() {
      while (inFlight.size < concurrency && dispatched < total) {
        dispatched++;
        const p = singleRequest().then((r) => {
          inFlight.delete(p);
          results.push(r);
          if (results.length === total) resolve(results);
          else dispatch();
        });
        inFlight.add(p);
      }
    }
    dispatch();
  });
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  console.log(`\nLoad testing GET ${ENDPOINT}`);
  console.log(`Concurrency: ${CONCURRENCY}  |  Total requests: ${TOTAL}\n`);

  const wallStart = performance.now();
  const results   = await runBatch(TOTAL, CONCURRENCY);
  const wallMs    = performance.now() - wallStart;

  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const errors    = results.filter((r) => !r.ok);
  const throughput = (TOTAL / (wallMs / 1000)).toFixed(2);

  console.log('── Results ─────────────────────────────');
  console.log(`  Total requests : ${TOTAL}`);
  console.log(`  Elapsed        : ${wallMs.toFixed(0)} ms`);
  console.log(`  Throughput     : ${throughput} req/s`);
  console.log(`  Errors         : ${errors.length} (${((errors.length / TOTAL) * 100).toFixed(1)}%)`);
  console.log(`  p50 latency    : ${percentile(durations, 50).toFixed(1)} ms`);
  console.log(`  p95 latency    : ${percentile(durations, 95).toFixed(1)} ms`);
  console.log(`  p99 latency    : ${percentile(durations, 99).toFixed(1)} ms`);
  console.log(`  Min latency    : ${durations[0].toFixed(1)} ms`);
  console.log(`  Max latency    : ${durations[durations.length - 1].toFixed(1)} ms`);
  console.log('────────────────────────────────────────\n');

  if (errors.length > 0) {
    const codes = errors.reduce((acc, r) => {
      acc[r.statusCode] = (acc[r.statusCode] ?? 0) + 1;
      return acc;
    }, {});
    console.warn('Error breakdown:', codes);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
