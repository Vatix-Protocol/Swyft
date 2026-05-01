"use client";

import { Token } from "./types";
import { TokenLogo } from "./TokenLogo";

interface Props {
  label: string;
  token: Token | null;
  amount: string;
  balance?: string;
  readOnly?: boolean;
  onAmountChange?: (value: string) => void;
  onTokenClick?: () => void;
}

export function SwapInput({
  label,
  token,
  amount,
  balance,
  readOnly = false,
  onAmountChange,
  onTokenClick,
}: Props) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (/^\d*\.?\d*$/.test(v)) onAmountChange?.(v);
  }

  const insufficient =
    !readOnly &&
    balance !== undefined &&
    parseFloat(amount || "0") > parseFloat(balance || "0");

  return (
    <div
      className={`rounded-xl border bg-zinc-50 px-4 py-3 dark:bg-zinc-800 transition-colors ${
        insufficient
          ? "border-red-400 dark:border-red-500"
          : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <p className="mb-1 text-xs text-zinc-400">{label}</p>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            readOnly={readOnly}
            onChange={handleChange}
            aria-label={`${label} amount`}
            className="w-full bg-transparent text-2xl font-semibold text-zinc-900 placeholder-zinc-300 focus:outline-none dark:text-white dark:placeholder-zinc-600"
          />
        </div>

        {token ? (
          <button
            type="button"
            onClick={onTokenClick}
            aria-label={`Selected token: ${token.symbol}. Click to change.`}
            className="flex shrink-0 items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-zinc-200 hover:ring-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-zinc-700 dark:text-white dark:ring-zinc-600 transition-all"
          >
            <TokenLogo token={token} size={20} />
            {token.symbol}
          </button>
        ) : (
          <button
            type="button"
            onClick={onTokenClick}
            className="shrink-0 rounded-full bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors"
          >
            Select token
          </button>
        )}
      </div>

      {balance !== undefined && (
        <div className="mt-1.5 flex items-center justify-between">
          <span className={`text-xs ${insufficient ? "text-red-500" : "text-zinc-400"}`}>
            {insufficient ? "Insufficient balance" : ""}
          </span>
          <button
            type="button"
            onClick={() => onAmountChange?.(balance)}
            className="text-xs text-zinc-400 hover:text-indigo-500 transition-colors"
            aria-label={`Use max balance: ${balance} ${token?.symbol ?? ""}`}
          >
            Balance: {parseFloat(balance).toFixed(4)} {token?.symbol}
          </button>
        </div>
      )}
    </div>
  );
}
