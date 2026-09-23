'use client';

import { Token, TokenPair } from './types';
import { TokenSelectorModal } from './TokenSelectorModal';

interface Props {
  /** The current token pair (tokenIn / tokenOut). Either side may be null. */
  pair: TokenPair;
  /** Full list of tokens available for selection in both selectors */
  tokens: Token[];
  /**
   * Map of token ID → formatted balance string passed through to each
   * {@link TokenSelectorModal}.
   */
  balances?: Record<string, string>;
  /**
   * Ordered list of recently used token IDs passed through to each
   * {@link TokenSelectorModal}.
   */
  recentIds?: string[];
  /** When true, both selectors show a loading spinner */
  loading?: boolean;
  /**
   * Whether a pool exists for the current pair.
   * - `true`  — pool found, no warning shown
   * - `false` — no pool found, an amber warning is rendered
   * - `null`  — pool check is still in progress, no warning shown
   */
  poolExists?: boolean | null;
  /**
   * Called whenever either token changes or the pair direction is swapped.
   * Receives the full updated {@link TokenPair}.
   */
  onChange: (pair: TokenPair) => void;
}

/**
 * A compound token-pair selector that renders two {@link TokenSelectorModal}
 * instances (input token and output token) with a swap-direction button
 * between them.
 *
 * Handles the "same token on both sides" edge case by automatically swapping
 * the opposite side when the user picks a token that is already selected on
 * the other side.
 *
 * Shows an amber warning when `poolExists` is `false` and both tokens are
 * selected.
 *
 * @example
 * ```tsx
 * <TokenPairSelector
 *   pair={pair}
 *   tokens={tokens}
 *   balances={walletBalances}
 *   poolExists={poolExists}
 *   onChange={setPair}
 * />
 * ```
 */
export function TokenPairSelector({
  pair,
  tokens,
  balances,
  recentIds,
  loading,
  poolExists,
  onChange,
}: Props) {
  function selectIn(token: Token) {
    // Swap sides if user picks the token already on the other side
    if (token.id === pair.tokenOut?.id) {
      onChange({ tokenIn: token, tokenOut: pair.tokenIn });
    } else {
      onChange({ ...pair, tokenIn: token });
    }
  }

  function selectOut(token: Token) {
    if (token.id === pair.tokenIn?.id) {
      onChange({ tokenIn: pair.tokenOut, tokenOut: token });
    } else {
      onChange({ ...pair, tokenOut: token });
    }
  }

  function swapPair() {
    onChange({ tokenIn: pair.tokenOut, tokenOut: pair.tokenIn });
  }

  const showWarning = poolExists === false && pair.tokenIn !== null && pair.tokenOut !== null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <TokenSelectorModal
          label="Input token"
          tokens={tokens}
          selected={pair.tokenIn}
          balances={balances}
          recentIds={recentIds}
          loading={loading}
          onSelect={selectIn}
        />

        <button
          onClick={swapPair}
          aria-label="Swap token pair direction"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:border-indigo-400 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-indigo-400 transition-colors"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"
            />
          </svg>
        </button>

        <TokenSelectorModal
          label="Output token"
          tokens={tokens}
          selected={pair.tokenOut}
          balances={balances}
          recentIds={recentIds}
          loading={loading}
          onSelect={selectOut}
        />
      </div>

      {showWarning && (
        <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
          No pool exists for this pair. You may need to create one.
        </p>
      )}
    </div>
  );
}
