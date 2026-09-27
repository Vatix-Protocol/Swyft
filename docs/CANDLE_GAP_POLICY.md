# Candle Gap Policy

> **Status:** Production  
> **Applies to:** `apps/web/hooks/usePriceCandles.ts`, `apps/web/components/PriceChart.tsx`

## Overview

A "gap" is a missing candle — a period within a requested time range for which
the API returned no OHLCV data. Gaps arise from:

- Periods of zero trading activity (no swaps executed in that interval).
- Partial API responses (pagination truncation, transient RPC outages).
- Stale WebSocket reconnects where the live feed resumes mid-series.

Without an explicit gap policy the chart renderer naively connects the last
known close to the next available open, producing phantom price movements and
misleading LP range visualisations.

---

## Policy rules

### Rule 1 — Synthetic gap candles

When the hook detects that two adjacent candles are separated by more than one
interval step, it inserts **synthetic gap candles** for each missing period.
A synthetic candle carries:

| Field    | Value                                           |
| -------- | ----------------------------------------------- |
| `time`   | Expected timestamp for the missing period       |
| `open`   | Previous candle's `close`                       |
| `high`   | Previous candle's `close`                       |
| `low`    | Previous candle's `close`                       |
| `close`  | Previous candle's `close`                       |
| `volume` | `0`                                             |
| `gap`    | `true` (discriminant — not rendered as a body)  |

Gap candles are rendered by `PriceChart` as a thin dotted vertical line
(the wick only, no body), visually distinguishing them from real zero-movement
candles.

### Rule 2 — Fail-closed on malformed timestamps

A candle whose `timestamp` is:

- `NaN` or `Infinity`
- In the future relative to `Date.now()` by more than one interval step
- Duplicated (same `time` as the preceding candle after sorting)

…is **silently dropped** by the hook before gap-filling. The chart never
receives malformed data.

### Rule 3 — Sort before gap-fill

The API guarantees ascending timestamp order but the live WebSocket feed may
deliver candles out-of-order during a reconnect burst. The hook sorts all
candles by `time` ascending before applying the gap-fill pass.

### Rule 4 — WebSocket live-merge respects gaps

When a live WebSocket candle arrives:

- If its `time` matches the last candle in the series, the last candle is
  replaced (tick update).
- If its `time` is one step ahead of the last candle, it is appended after
  trimming the series to 167 candles (keeping 168 total).
- If its `time` is more than one step ahead, gap candles are inserted before
  appending so Rule 1 is maintained for the live path.
- If its `time` is behind the last candle's `time`, it is ignored (stale
  delivery).

### Rule 5 — Gap candles do not count toward the 168-candle window

The 168-candle limit applies to **real** candles only. Gap candles are counted
separately and are pruned whenever the chart is re-rendered with a fresh
REST fetch.

---

## Interval step sizes

| Interval | Step (seconds) |
| -------- | -------------- |
| `1m`     | 60             |
| `5m`     | 300            |
| `1h`     | 3 600          |
| `1d`     | 86 400         |

---

## Rollback / kill-switch

Gap-filling is enabled by default.  To disable it (e.g. while debugging a
data pipeline issue), set the environment variable:

```
NEXT_PUBLIC_CANDLE_GAP_FILL=false
```

When disabled the hook returns the raw API candles unchanged and the chart
renders them without interpolation. This flag is intentionally not persisted to
`localStorage`; it requires an explicit redeploy and documents the risk in the
PR that changes it.

---

## References

- `apps/web/hooks/usePriceCandles.ts` — gap-fill implementation
- `apps/web/components/PriceChart.tsx` — gap candle rendering (dotted wick)
- `apps/api/src/` — `/v1/prices/:a/:b/candles` endpoint
