# Metrics Endpoints

This document describes the metrics endpoints available for operators to monitor the Swyft API health and performance.

## Overview

All metrics endpoints require the `x-internal-key` header for authentication. This key is configured via the `INTERNAL_API_KEY` environment variable.

**Base path:** `/v1/metrics/`

## Endpoints

### 1. Database Metrics

**Endpoint:** `GET /v1/metrics/db`

**Authentication:** Required (`x-internal-key` header)

**Description:** Returns database query performance metrics and cache statistics.

**Response format (JSON):**

```json
{
  "totalQueries": 12345,
  "avgQueryTimeMs": 45.67,
  "p95QueryTimeMs": 120,
  "slowQueryCount": 42,
  "cacheHitRate": 0.85,
  "poolCount": 250,
  "swapRatePerMinute": 15
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `totalQueries` | number | Total number of database queries executed since API start |
| `avgQueryTimeMs` | number | Average query duration in milliseconds (rounded to 2 decimals) |
| `p95QueryTimeMs` | number | 95th percentile query duration (p95 latency) |
| `slowQueryCount` | number | Number of queries exceeding `DB_SLOW_QUERY_THRESHOLD_MS` (default 100ms) |
| `cacheHitRate` | number \| null | Cache hit ratio (0.0-1.0), null if unavailable |
| `poolCount` | number | Total number of active pools in the system |
| `swapRatePerMinute` | number | Number of swaps in the last 60 seconds |

**Use cases:**

- Track database performance degradation
- Monitor slow query trends
- Verify cache effectiveness
- Alert on unusual swap activity

**Example curl:**

```bash
curl -H "x-internal-key: $INTERNAL_API_KEY" \
  https://api.example.com/v1/metrics/db
```

---

### 2. Indexer Metrics (Lag Monitoring)

**Endpoint:** `GET /v1/metrics/indexer`

**Authentication:** Required (`x-internal-key` header)

**Description:** Returns indexer health status and ledger lag relative to Stellar Horizon.

**Response format (JSON):**

```json
{
  "lastIndexedLedger": 50000000,
  "latestLedger": 50000010,
  "lagLedgers": 10,
  "lagSeconds": 50,
  "status": "healthy"
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `lastIndexedLedger` | number | The last ledger sequence number processed by the indexer |
| `latestLedger` | number | The latest ledger sequence number on Stellar Horizon |
| `lagLedgers` | number | Number of ledgers the indexer is behind (0 if caught up) |
| `lagSeconds` | number | Approximate time lag in seconds (lagLedgers × 5 seconds per ledger) |
| `status` | string | Health status: `'healthy'` \| `'degraded'` \| `'critical'` |

**Status thresholds:**

| Status | Condition |
|--------|-----------|
| `healthy` | No checkpoint yet, or lag < 10 ledgers |
| `degraded` | 10 ≤ lag ≤ 50 ledgers (~50-250 seconds behind) |
| `critical` | lag > 50 ledgers (>250 seconds behind) |

**Lag calculation:**

- `lagLedgers = max(0, latestLedger - lastIndexedLedger)`
- `lagSeconds = lagLedgers × 5` (Stellar closes ~1 ledger per 5 seconds)

**Use cases:**

- **Monitoring dashboard:** Display real-time indexer lag in UI
- **Alerting:** Trigger alerts when status transitions to "degraded" or "critical"
- **SLO tracking:** Ensure indexer stays within lag thresholds
- **Debugging:** Correlate lag spikes with known events

**Example curl:**

```bash
curl -H "x-internal-key: $INTERNAL_API_KEY" \
  https://api.example.com/v1/metrics/indexer
```

**Example alert rule (Prometheus-style):**

```
alert: IndexerLagCritical
expr: metrics_indexer_lag_ledgers > 50
for: 5m
```

---

## Configuration

### Authentication

Set `INTERNAL_API_KEY` environment variable:

```bash
export INTERNAL_API_KEY="your-secret-key-here"
```

All metrics requests must include:

```
Headers:
  x-internal-key: $INTERNAL_API_KEY
```

### Database Metrics Configuration

**`DB_SLOW_QUERY_THRESHOLD_MS`** (default: 100)

Queries exceeding this duration are counted in `slowQueryCount`.

```bash
export DB_SLOW_QUERY_THRESHOLD_MS=200  # Increase threshold to 200ms
```

### Indexer Monitoring

Indexer lag is checked every 30 seconds. No configuration needed.

---

## Integration Examples

### Grafana Dashboard

Query metrics periodically and chart lag over time:

```
GET /v1/metrics/indexer every 1 minute
Graph: lagSeconds on Y-axis, timestamp on X-axis
Alert: if lagSeconds > 250 for 5 minutes
```

### Datadog/New Relic Integration

```bash
#!/bin/bash
while true; do
  curl -s -H "x-internal-key: $INTERNAL_API_KEY" \
    https://api.example.com/v1/metrics/indexer | \
    jq '.lagSeconds' | \
    datadog_agent send_metric indexer.lag
  sleep 60
done
```

### Slack Alerts

Use a bot to query metrics and post alerts:

```
every 5 minutes:
  GET /v1/metrics/indexer
  if status == "critical":
    POST to #alerts: "Indexer lag critical: {{lagSeconds}}s"
```

---

## Troubleshooting

### Metrics endpoint returns 401 Unauthorized

Check that:
1. `INTERNAL_API_KEY` environment variable is set
2. `x-internal-key` header matches the configured key
3. Request includes the header exactly: `x-internal-key: value` (case-sensitive)

### Indexer lag is increasing

Possible causes:

1. **Network latency:** Check connectivity to Stellar Horizon
2. **Database bottleneck:** Monitor `avgQueryTimeMs` — if rising, query performance degraded
3. **Indexer crash:** Check logs for error messages
4. **High traffic:** Increased swap activity can slow indexing

### lagLedgers stays at 0

This is normal when:
- Indexer is fully caught up (desired state)
- No checkpoint has been stored yet (initial startup)

---

## API Response Times

Metrics endpoints are lightweight and should respond in < 100ms:

- `GET /v1/metrics/db` — in-memory snapshot (< 10ms)
- `GET /v1/metrics/indexer` — Redis lookup + Horizon call cached every 30s (< 50ms)

---

## Rate Limiting

Metrics endpoints are exempt from standard rate limiting to ensure monitoring always works.

---

## Data Retention

- **DB metrics:** In-memory rolling window (10,000 query samples)
- **Indexer lag:** Cached for 30 seconds, refreshed automatically
- **Checkpoints:** Persistent in Redis (survives API restart)

---

## Security Considerations

- Metrics endpoints require authentication to prevent information leakage
- Lag information itself is not sensitive (already public via Horizon)
- Query performance metrics could reveal architecture details; restrict access to trusted operators only
