# Candle gap-fill policy

## Policy: null buckets (no carry-forward)

When the price API returns OHLCV candles for a `[from, to]` range, every
aligned interval bucket in that range is present in the response (subject to
`limit`).

| Situation                         | Response                                      |
| --------------------------------- | --------------------------------------------- |
| Trades exist in the bucket        | Real OHLCV values                             |
| No trades in the bucket (a gap)   | **Null bucket** — `open`/`high`/`low`/`close`/`volume` are all `null` |
| Bucket outside `[from, to]`       | Omitted                                       |

## Why null (not carry-forward)

- Charts and indicators can distinguish “no activity” from “price unchanged”.
- Carry-forward invents closes that never traded and inflates continuity.
- Null buckets keep the series length predictable for fixed-interval UIs.

## Alignment

Bucket timestamps are floored to the interval boundary (unix seconds):

- `1m` → 60s
- `5m` → 300s
- `1h` → 3600s
- `1d` → 86400s

Implementation: `fillCandleGaps` / `nullCandle` in `apps/api/src/price/price.service.ts`.
