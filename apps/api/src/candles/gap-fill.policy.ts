import { CandleInterval } from './candles.service';

export interface OhlcvBucket {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

const INTERVAL_SECONDS: Record<CandleInterval, number> = {
  '1m': 60,
  '5m': 300,
  '1h': 3600,
  '1d': 86400,
};

/**
 * Gap fill policy for missing candle buckets: a missing bucket is
 * "flat filled" using the previous bucket's close price (open = high = low =
 * close = last known close) with zero volume, signalling no trading activity
 * occurred rather than interpolating a price change. Leading gaps (no prior
 * bucket exists yet) are left unfilled since there is no known price to carry
 * forward.
 */
export function fillCandleGaps(
  buckets: OhlcvBucket[],
  interval: CandleInterval,
): OhlcvBucket[] {
  if (buckets.length === 0) {
    return buckets;
  }

  const step = INTERVAL_SECONDS[interval];
  const sorted = [...buckets].sort((a, b) => a.timestamp - b.timestamp);
  const filled: OhlcvBucket[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    let expected = filled[filled.length - 1].timestamp + step;
    const current = sorted[i];

    while (expected < current.timestamp) {
      const lastClose = filled[filled.length - 1].close;
      filled.push({
        timestamp: expected,
        open: lastClose,
        high: lastClose,
        low: lastClose,
        close: lastClose,
        volume: '0',
      });
      expected += step;
    }

    filled.push(current);
  }

  return filled;
}
