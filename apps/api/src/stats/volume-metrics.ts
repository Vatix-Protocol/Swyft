export interface SwapAmounts {
  amount0: string;
  amount1: string;
}

export function isInHalfOpenWindow(
  timestamp: Date,
  start: Date,
  end: Date,
): boolean {
  const time = timestamp.getTime();
  return (
    Number.isFinite(time) && time >= start.getTime() && time < end.getTime()
  );
}

function usdAmount(
  rawAmount: string,
  decimals: number,
  priceUsd: number,
): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('Token decimals are invalid');
  }
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error('Token USD price is invalid');
  }
  if (!/^-?\d+$/.test(rawAmount)) {
    throw new Error('Swap amount is invalid');
  }

  const raw = BigInt(rawAmount);
  const amount = Number(raw < 0n ? -raw : raw) / 10 ** decimals;
  const value = amount * priceUsd;
  if (!Number.isFinite(value)) throw new Error('Swap USD amount is invalid');
  return value;
}

export function calculateSwapVolumeUsd(
  swap: SwapAmounts,
  decimals0: number,
  decimals1: number,
  price0: number,
  price1: number,
): number {
  return (
    usdAmount(swap.amount0, decimals0, price0) +
    usdAmount(swap.amount1, decimals1, price1)
  );
}

export function calculateSwapFeesUsd(
  feeAmount0: string,
  decimals0: number,
  price0: number,
): number {
  return usdAmount(feeAmount0, decimals0, price0);
}
