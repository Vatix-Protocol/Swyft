export interface SwapQuoteParams {
  poolId: string;
  tokenInId: string;
  tokenOutId: string;
  amountIn: string;
  slippageBps: number;
}

export interface SwapQuote {
  amountOut: string;
  priceImpact: number;
  lpFee: string;
  protocolFee: string;
  minimumReceived: string;
  executionPrice: string;
}

export function calculateSwapQuote(params: SwapQuoteParams): SwapQuote {
  const amountIn = parseFloat(params.amountIn);
  if (!amountIn || amountIn <= 0) {
    return { amountOut: "0", priceImpact: 0, lpFee: "0", protocolFee: "0", minimumReceived: "0", executionPrice: "0" };
  }
  const reserveIn = 1_000_000;
  const reserveOut = 1_000_000;
  const lpFeeBps = 30;
  const lpFeeAmt = amountIn * (lpFeeBps / 10_000);
  const amountInAfterFee = amountIn - lpFeeAmt;
  const amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
  const spotPrice = reserveOut / reserveIn;
  const executionPrice = amountOut / amountIn;
  const priceImpact = Math.max(0, ((spotPrice - executionPrice) / spotPrice) * 100);
  const minimumReceived = amountOut * (1 - params.slippageBps / 10_000);
  return {
    amountOut: amountOut.toFixed(7),
    priceImpact: parseFloat(priceImpact.toFixed(4)),
    lpFee: lpFeeAmt.toFixed(7),
    protocolFee: "0",
    minimumReceived: minimumReceived.toFixed(7),
    executionPrice: executionPrice.toFixed(7),
  };
}
