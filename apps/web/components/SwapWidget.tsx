"use client";

import { useState } from "react";
import { SwapInput, PriceImpactBadge, SlippagePanel, type TokenPair, type Token } from "@swyft/ui";
import { useTokens, useRecentTokens, usePoolId } from "@/hooks/useTokens";
import { useSwapQuote } from "@/hooks/useSwapQuote";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { SwapConfirmModal } from "@/components/SwapConfirmModal";

// Inline minimal token selector trigger — full modal from @swyft/ui used in the SwapInput onTokenClick
// For this branch we keep a simple inline selector; the full TokenSelectorModal lives in feat/token-pair-selector
function TokenPickerButton({
  token,
  tokens,
  onSelect,
  exclude,
}: {
  token: Token | null;
  tokens: Token[];
  onSelect: (t: Token) => void;
  exclude?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const available = tokens.filter((t) => t.id !== exclude);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-zinc-200 hover:ring-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-zinc-700 dark:text-white dark:ring-zinc-600"
      >
        {token ? token.symbol : <span className="text-indigo-600">Select</span>}
        <svg className="h-3.5 w-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Select token"
          className="absolute right-0 top-full z-30 mt-1 max-h-48 w-40 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {available.length === 0 && (
            <li className="px-3 py-2 text-xs text-zinc-400">No tokens available</li>
          )}
          {available.map((t) => (
            <li key={t.id} role="option" aria-selected={t.id === token?.id}>
              <button
                type="button"
                onClick={() => { onSelect(t); setOpen(false); }}
                className="w-full px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t.symbol}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface WalletState {
  address: string | null;
}

// Consumed via prop so this component stays decoupled from a specific context shape
interface Props {
  wallet: WalletState;
  onTokenInChange?: (token: Token | null) => void;
  onTokenOutChange?: (token: Token | null) => void;
  onSwapSuccess?: () => void;
}

export function SwapWidget({ wallet, onTokenInChange, onTokenOutChange, onSwapSuccess }: Props) {
  const { tokens, loading: tokensLoading } = useTokens();
  const { recentIds, pushRecent } = useRecentTokens();
  const [pair, setPair] = useState<TokenPair>({ tokenIn: null, tokenOut: null });
  const [amountIn, setAmountIn] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [showModal, setShowModal] = useState(false);

  const { poolId, poolExists } = usePoolId(pair.tokenIn?.id ?? null, pair.tokenOut?.id ?? null);
  const { quote, loading: quoteLoading } = useSwapQuote({
    poolId,
    tokenInId: pair.tokenIn?.id ?? null,
    tokenOutId: pair.tokenOut?.id ?? null,
    amountIn,
    slippageBps,
  });

  const tokenIds = [pair.tokenIn?.id, pair.tokenOut?.id].filter(Boolean) as string[];
  const balances = useWalletBalances(wallet.address, tokenIds);

  const inBalance = pair.tokenIn ? (balances[pair.tokenIn.id] ?? undefined) : undefined;
  const outBalance = pair.tokenOut ? (balances[pair.tokenOut.id] ?? undefined) : undefined;

  const insufficient =
    inBalance !== undefined &&
    parseFloat(amountIn || "0") > parseFloat(inBalance);

  const swapDisabled =
    !wallet.address ||
    !pair.tokenIn ||
    !pair.tokenOut ||
    !amountIn ||
    parseFloat(amountIn) <= 0 ||
    insufficient ||
    !quote;

  function selectIn(token: Token) {
    const next = token.id === pair.tokenOut?.id
      ? { tokenIn: token, tokenOut: pair.tokenIn }
      : { ...pair, tokenIn: token };
    setPair(next);
    onTokenInChange?.(token);
    if (token.id === pair.tokenOut?.id) onTokenOutChange?.(pair.tokenIn ?? null);
    pushRecent(token.id);
  }

  function selectOut(token: Token) {
    const next = token.id === pair.tokenIn?.id
      ? { tokenIn: pair.tokenOut, tokenOut: token }
      : { ...pair, tokenOut: token };
    setPair(next);
    onTokenOutChange?.(token);
    if (token.id === pair.tokenIn?.id) onTokenInChange?.(pair.tokenOut ?? null);
    pushRecent(token.id);
  }

  function swapDirection() {
    setPair({ tokenIn: pair.tokenOut, tokenOut: pair.tokenIn });
    onTokenInChange?.(pair.tokenOut ?? null);
    onTokenOutChange?.(pair.tokenIn ?? null);
    setAmountIn(quote?.amountOut ?? "");
  }

  const highImpact = quote && quote.priceImpact >= 5;

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Swap</h2>
        <SlippagePanel slippageBps={slippageBps} onChange={setSlippageBps} />
      </div>

      <div className="px-4 pb-4 flex flex-col gap-2">
        {/* Sell input */}
        <div className="relative">
          <SwapInput
            label="You pay"
            token={pair.tokenIn}
            amount={amountIn}
            balance={inBalance}
            onAmountChange={setAmountIn}
            onTokenClick={() => {}}
          />
          {/* Token picker overlaid on the input's token button area */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <TokenPickerButton
              token={pair.tokenIn}
              tokens={tokens}
              onSelect={selectIn}
              exclude={pair.tokenOut?.id}
            />
          </div>
        </div>

        {/* Swap direction button */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={swapDirection}
            aria-label="Swap token pair direction"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:border-indigo-400 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-indigo-400 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {/* Buy input */}
        <div className="relative">
          <SwapInput
            label="You receive"
            token={pair.tokenOut}
            amount={quoteLoading ? "" : (quote?.amountOut ?? "")}
            balance={outBalance}
            readOnly
            onTokenClick={() => {}}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <TokenPickerButton
              token={pair.tokenOut}
              tokens={tokens}
              onSelect={selectOut}
              exclude={pair.tokenIn?.id}
            />
          </div>
          {quoteLoading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/60 dark:bg-zinc-900/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" aria-label="Calculating quote" />
            </div>
          )}
        </div>

        {/* Quote details */}
        {quote && pair.tokenIn && pair.tokenOut && (
          <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span>Rate</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                1 {pair.tokenIn.symbol} = {parseFloat(quote.executionPrice).toFixed(6)} {pair.tokenOut.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Price impact</span>
              <PriceImpactBadge impact={quote.priceImpact} />
            </div>
            <div className="flex items-center justify-between">
              <span>Min. received</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {parseFloat(quote.minimumReceived).toFixed(6)} {pair.tokenOut.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>LP fee</span>
              <span>{parseFloat(quote.lpFee).toFixed(7)} {pair.tokenIn.symbol}</span>
            </div>
            {parseFloat(quote.protocolFee) > 0 && (
              <div className="flex items-center justify-between">
                <span>Protocol fee</span>
                <span>{parseFloat(quote.protocolFee).toFixed(7)} {pair.tokenIn.symbol}</span>
              </div>
            )}
          </div>
        )}

        {/* No pool warning */}
        {poolExists === false && pair.tokenIn && pair.tokenOut && (
          <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
            No pool exists for this pair.
          </p>
        )}

        {/* High price impact warning */}
        {highImpact && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-xs font-medium text-red-700 dark:text-red-400">
              Price impact is {quote!.priceImpact.toFixed(2)}% — this trade may result in significant losses.
            </p>
          </div>
        )}

        {/* Swap button */}
        <button
          type="button"
          onClick={() => setShowModal(true)}
          disabled={swapDisabled}
          aria-disabled={swapDisabled}
          className="mt-1 w-full min-h-[44px] rounded-xl bg-indigo-600 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {!wallet.address
            ? "Connect wallet to swap"
            : !pair.tokenIn || !pair.tokenOut
            ? "Select tokens"
            : !amountIn || parseFloat(amountIn) <= 0
            ? "Enter an amount"
            : insufficient
            ? "Insufficient balance"
            : "Swap"}
        </button>
      </div>
    </div>

    {/* Confirmation modal */}
    {showModal && quote && pair.tokenIn && pair.tokenOut && wallet.address && poolId && (
      <SwapConfirmModal
        poolId={poolId}
        tokenIn={pair.tokenIn}
        tokenOut={pair.tokenOut}
        amountIn={amountIn}
        quote={quote}
        walletAddress={wallet.address}
        onClose={() => setShowModal(false)}
        onSuccess={() => {
          setShowModal(false);
          setAmountIn("");
          onSwapSuccess?.();
        }}
      />
    )}
  );
}
