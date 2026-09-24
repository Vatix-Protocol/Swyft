#!/usr/bin/env node
'use strict';

/**
 * Pool load-test harness (issue #994).
 *
 * Drives the Swyft pool read/write endpoints under a bounded, budgeted load so
 * that contributors can validate liquidity/trading/settlement behavior without
 * accidentally hammering production. Fail-closed by default: writes are only
 * issued when explicitly enabled AND the target is not mainnet.
 *
 * Stable error codes (see ERROR_CODES) are emitted on every failure so callers
 * and CI can assert on them. Every request carries a correlation id.
 */

const crypto = require('crypto');

const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'LOADTEST_INVALID_INPUT',
  AUTH_REQUIRED: 'LOADTEST_AUTH_REQUIRED',
  WRITES_DISABLED: 'LOADTEST_WRITES_DISABLED',
  MAINNET_BLOCKED: 'LOADTEST_MAINNET_BLOCKED',
  BUDGET_EXCEEDED: 'LOADTEST_BUDGET_EXCEEDED',
  DEPENDENCY_UNAVAILABLE: 'LOADTEST_DEPENDENCY_UNAVAILABLE',
  REQUEST_FAILED: 'LOADTEST_REQUEST_FAILED',
});

const NETWORKS = Object.freeze({ TESTNET: 'testnet', MAINNET: 'mainnet' });

class LoadTestError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'LoadTestError';
    this.code = code;
    this.details = details || {};
  }
}

function newCorrelationId() {
  return crypto.randomUUID();
}

function parsePositiveInt(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new LoadTestError(
      ERROR_CODES.INVALID_INPUT,
      `${name} must be an integer between ${min} and ${max}`,
      { name, value },
    );
  }
  return parsed;
}

/**
 * Validate and normalize the harness configuration. Deny-by-default: writes
 * require an explicit opt-in and a non-mainnet network.
 */
function resolveConfig(env = process.env) {
  const baseUrl = env.SWYFT_API_BASE_URL;
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new LoadTestError(ERROR_CODES.INVALID_INPUT, 'SWYFT_API_BASE_URL is required');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch (err) {
    throw new LoadTestError(ERROR_CODES.INVALID_INPUT, 'SWYFT_API_BASE_URL must be a valid URL', {
      baseUrl,
    });
  }

  const network = (env.SWYFT_NETWORK || NETWORKS.TESTNET).toLowerCase();
  if (network !== NETWORKS.TESTNET && network !== NETWORKS.MAINNET) {
    throw new LoadTestError(ERROR_CODES.INVALID_INPUT, 'SWYFT_NETWORK must be testnet or mainnet', {
      network,
    });
  }

  const allowWrites = String(env.SWYFT_LOADTEST_ALLOW_WRITES || '').toLowerCase() === 'true';
  if (allowWrites && network === NETWORKS.MAINNET) {
    throw new LoadTestError(
      ERROR_CODES.MAINNET_BLOCKED,
      'Refusing to run write load tests against mainnet',
      { network },
    );
  }

  const token = env.SWYFT_LOADTEST_TOKEN;
  if (!token) {
    throw new LoadTestError(
      ERROR_CODES.AUTH_REQUIRED,
      'SWYFT_LOADTEST_TOKEN is required; untrusted clients cannot bypass policy',
    );
  }

  return {
    baseUrl: parsedUrl.origin,
    network,
    allowWrites,
    token,
    concurrency: parsePositiveInt(env.SWYFT_LOADTEST_CONCURRENCY || 4, 'SWYFT_LOADTEST_CONCURRENCY', {
      min: 1,
      max: 64,
    }),
    durationMs: parsePositiveInt(env.SWYFT_LOADTEST_DURATION_MS || 5000, 'SWYFT_LOADTEST_DURATION_MS', {
      min: 100,
      max: 600000,
    }),
    maxRequests: parsePositiveInt(env.SWYFT_LOADTEST_MAX_REQUESTS || 1000, 'SWYFT_LOADTEST_MAX_REQUESTS', {
      min: 1,
      max: 1000000,
    }),
    requestTimeoutMs: parsePositiveInt(env.SWYFT_LOADTEST_TIMEOUT_MS || 5000, 'SWYFT_LOADTEST_TIMEOUT_MS', {
      min: 100,
      max: 60000,
    }),
  };
}

/**
 * Budget tracker. Enforces a hard ceiling on total requests so a runaway loop
 * cannot grief the target. Fail-closed: once exhausted, further calls throw.
 */
class Budget {
  constructor(maxRequests) {
    this.maxRequests = maxRequests;
    this.issued = 0;
  }

  consume() {
    if (this.issued >= this.maxRequests) {
      throw new LoadTestError(
        ERROR_CODES.BUDGET_EXCEEDED,
        `Request budget of ${this.maxRequests} exhausted`,
        { maxRequests: this.maxRequests },
      );
    }
    this.issued += 1;
    return this.issued;
  }
}

/**
 * Issue a single request with a correlation id, timeout, and stable error
 * mapping. Dependency outages (RPC/DB/Redis surfaced as 5xx) fail closed.
 */
async function issueRequest(config, budget, { method, path, body, idempotencyKey }) {
  budget.consume();
  const correlationId = newCorrelationId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  const headers = {
    authorization: `Bearer ${config.token}`,
    'x-correlation-id': correlationId,
    accept: 'application/json',
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (idempotencyKey) {
    headers['idempotency-key'] = idempotencyKey;
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;

    if (response.status === 401 || response.status === 403) {
      throw new LoadTestError(ERROR_CODES.AUTH_REQUIRED, 'Authorization rejected', {
        status: response.status,
        correlationId,
      });
    }
    if (response.status >= 500) {
      throw new LoadTestError(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        'Upstream dependency unavailable; failing closed',
        { status: response.status, correlationId },
      );
    }
    if (!response.ok) {
      throw new LoadTestError(ERROR_CODES.REQUEST_FAILED, 'Request failed', {
        status: response.status,
        correlationId,
      });
    }

    return { status: response.status, latencyMs, correlationId };
  } catch (err) {
    if (err instanceof LoadTestError) throw err;
    throw new LoadTestError(ERROR_CODES.REQUEST_FAILED, err.message, { correlationId });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the budgeted load loop. Reads are always allowed; writes require the
 * explicit opt-in resolved in resolveConfig. Idempotency keys make replayed
 * write requests safe.
 */
async function runLoadTest(config, { logger = console } = {}) {
  const budget = new Budget(config.maxRequests);
  const deadline = Date.now() + config.durationMs;
  const stats = { issued: 0, ok: 0, failed: 0, latencies: [] };

  async function worker() {
    while (Date.now() < deadline) {
      let result;
      try {
        result = await issueRequest(config, budget, {
          method: 'GET',
          path: '/pools',
        });
      } catch (err) {
        if (err.code === ERROR_CODES.BUDGET_EXCEEDED) return;
        stats.failed += 1;
        logger.error(
          JSON.stringify({ level: 'error', code: err.code, correlationId: err.details.correlationId }),
        );
        continue;
      }
      stats.issued += 1;
      stats.ok += 1;
      stats.latencies.push(result.latencyMs);

      if (config.allowWrites) {
        try {
          await issueRequest(config, budget, {
            method: 'POST',
            path: '/pools/quote',
            body: { amount: '1' },
            idempotencyKey: newCorrelationId(),
          });
        } catch (err) {
          if (err.code === ERROR_CODES.BUDGET_EXCEEDED) return;
          stats.failed += 1;
          logger.error(
            JSON.stringify({ level: 'error', code: err.code, correlationId: err.details.correlationId }),
          );
        }
      }
    }
  }

  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

  const sorted = stats.latencies.slice().sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  const summary = {
    level: 'info',
    network: config.network,
    allowWrites: config.allowWrites,
    issued: stats.issued,
    ok: stats.ok,
    failed: stats.failed,
    p95LatencyMs: p95,
  };
  logger.log(JSON.stringify(summary));
  return summary;
}

async function main() {
  try {
    const config = resolveConfig();
    await runLoadTest(config);
  } catch (err) {
    const code = err instanceof LoadTestError ? err.code : ERROR_CODES.REQUEST_FAILED;
    process.stderr.write(JSON.stringify({ level: 'error', code, message: err.message }) + '\n');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ERROR_CODES,
  NETWORKS,
  LoadTestError,
  Budget,
  resolveConfig,
  issueRequest,
  runLoadTest,
  newCorrelationId,
};
