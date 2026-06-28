import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify that a received webhook payload matches the HMAC-SHA256 signature
 * sent in the `X-Swyft-Signature` header. Returns false for any invalid input.
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  try {
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

export const WEBHOOK_EVENTS = [
  'pool.created',
  'swap',
  'swap.large',
  'pool.tvl.milestone',
  'position.minted',
  'position.burned',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── Per-event payload shapes ─────────────────────────────────────────────────

/** Emitted when a new concentrated-liquidity pool is deployed on Stellar. */
export interface PoolCreatedData {
  poolId: string;
  token0: string;
  token1: string;
  feeBps: number;
  /** Square-root of the initial price, encoded as a 128-bit fixed-point string. */
  sqrtPriceX96: string;
  tick: number;
}

/** Emitted for every swap executed through a Swyft pool. */
export interface SwapData {
  poolId: string;
  sender: string;
  recipient: string;
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
  priceImpactBps: number;
  txHash: string;
}

/** Emitted when a swap exceeds the `largeSwapUsd` threshold on the webhook. */
export interface SwapLargeData extends SwapData {
  amountUsd: number;
}

/** Emitted when a pool's TVL crosses a round-number USD milestone. */
export interface PoolTvlMilestoneData {
  poolId: string;
  token0: string;
  token1: string;
  tvlUsd: number;
  milestone: number;
}

/** Emitted when a new LP position NFT is minted. */
export interface PositionMintedData {
  positionId: string;
  poolId: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
}

/** Emitted when an LP position is fully or partially burned. */
export interface PositionBurnedData {
  positionId: string;
  poolId: string;
  owner: string;
  liquidity: string;
  amount0: string;
  amount1: string;
}

/** Maps each event type to its strongly-typed data shape. */
export interface WebhookEventDataMap {
  'pool.created': PoolCreatedData;
  swap: SwapData;
  'swap.large': SwapLargeData;
  'pool.tvl.milestone': PoolTvlMilestoneData;
  'position.minted': PositionMintedData;
  'position.burned': PositionBurnedData;
}

/** Typed webhook payload keyed by event. */
export type TypedWebhookPayload<E extends WebhookEventType> = {
  event: E;
  timestamp: string;
  data: WebhookEventDataMap[E];
};

// ─── Example payloads (used in docs / tests) ──────────────────────────────────

export const WEBHOOK_PAYLOAD_EXAMPLES: {
  [E in WebhookEventType]: TypedWebhookPayload<E>;
} = {
  'pool.created': {
    event: 'pool.created',
    timestamp: '2025-01-15T10:30:00.000Z',
    data: {
      poolId: 'pool_GPOOL123',
      token0: 'XLM',
      token1: 'USDC',
      feeBps: 30,
      sqrtPriceX96: '79228162514264337593543950336',
      tick: 0,
    },
  },
  swap: {
    event: 'swap',
    timestamp: '2025-01-15T10:31:00.000Z',
    data: {
      poolId: 'pool_GPOOL123',
      sender: 'GABC...XYZ',
      recipient: 'GABC...XYZ',
      amountIn: '1000000000',
      amountOut: '99850000',
      tokenIn: 'XLM',
      tokenOut: 'USDC',
      priceImpactBps: 5,
      txHash: 'abc123def456',
    },
  },
  'swap.large': {
    event: 'swap.large',
    timestamp: '2025-01-15T10:32:00.000Z',
    data: {
      poolId: 'pool_GPOOL123',
      sender: 'GABC...XYZ',
      recipient: 'GABC...XYZ',
      amountIn: '50000000000',
      amountOut: '4990000000',
      tokenIn: 'XLM',
      tokenOut: 'USDC',
      priceImpactBps: 42,
      txHash: 'def789ghi012',
      amountUsd: 15000,
    },
  },
  'pool.tvl.milestone': {
    event: 'pool.tvl.milestone',
    timestamp: '2025-01-15T10:33:00.000Z',
    data: {
      poolId: 'pool_GPOOL123',
      token0: 'XLM',
      token1: 'USDC',
      tvlUsd: 1000000,
      milestone: 1000000,
    },
  },
  'position.minted': {
    event: 'position.minted',
    timestamp: '2025-01-15T10:34:00.000Z',
    data: {
      positionId: 'pos_GPOS456',
      poolId: 'pool_GPOOL123',
      owner: 'GABC...XYZ',
      tickLower: -100,
      tickUpper: 100,
      liquidity: '1000000000000',
      amount0: '500000000',
      amount1: '499000000',
    },
  },
  'position.burned': {
    event: 'position.burned',
    timestamp: '2025-01-15T10:35:00.000Z',
    data: {
      positionId: 'pos_GPOS456',
      poolId: 'pool_GPOOL123',
      owner: 'GABC...XYZ',
      liquidity: '1000000000000',
      amount0: '502000000',
      amount1: '497500000',
    },
  },
};
