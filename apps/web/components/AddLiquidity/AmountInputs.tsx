"use client";

interface Props {
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  balance0?: string;
  balance1?: string;
  token0Only?: boolean;
  token1Only?: boolean;
  onAmount0Change: (v: string) => void;
  onAmount1Change: (v: string) => void;
}

function TokenInput({
  label,
  symbol,
  amount,
  balance,
  disabled,
  onChange,
}: {
  label: string;
  symbol: string;
  amount: string;
  balance?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const insufficient =
    !disabled &&
    balance !== undefined &&
    parseFloat(amount || "0") > parseFloat(balance || "0");

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (/^\d*\.?\d*$/.test(v)) onChange(v);
  }

  return (
    <div
      className={`rounded-xl border px-4 py-3 transition-colors ${
        disabled
          ? "border-zinc-100 bg-zinc-50 opacity-50 dark:border-zinc-800 dark:bg-zinc-900/30"
          : insufficient
          ? "border-red-400 bg-white dark:border-red-500 dark:bg-zinc-900"
          : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <p className="mb-1 text-xs text-zinc-400">{label}</p>
          <input
            type="text"
            inputMode="decimal"
            placeholder={disabled ? "—" : "0.00"}
            value={amount}
            readOnly={disabled}
            onChange={handleChange}
            aria-label={`${label} amount`}
            className="w-full bg-transparent text-2xl font-semibold text-zinc-900 placeholder-zinc-300 focus:outline-none dark:text-white dark:placeholder-zinc-600"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 dark:bg-zinc-800">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[9px] font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
            {symbol.slice(0, 2)}
          </div>
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{symbol}</span>
        </div>
      </div>
      {balance !== undefined && !disabled && (
        <div className="mt-1.5 flex justify-between">
          <span className={`text-xs ${insufficient ? "text-red-500" : "text-transparent"}`}>
            {insufficient ? "Insufficient balance" : "."}
          </span>
          <button
            type="button"
            onClick={() => onChange(balance)}
            className="text-xs text-zinc-400 hover:text-indigo-500 transition-colors"
          >
            Balance: {parseFloat(balance).toFixed(4)} {symbol}
          </button>
        </div>
      )}
      {disabled && (
        <p className="mt-1 text-xs text-zinc-400">Not required for this range</p>
      )}
    </div>
  );
}

export function AmountInputs({
  token0Symbol,
  token1Symbol,
  amount0,
  amount1,
  balance0,
  balance1,
  token0Only,
  token1Only,
  onAmount0Change,
  onAmount1Change,
}: Props) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Deposit amounts</p>
      <TokenInput
        label={token0Symbol}
        symbol={token0Symbol}
        amount={amount0}
        balance={balance0}
        disabled={token1Only}
        onChange={onAmount0Change}
      />
      <TokenInput
        label={token1Symbol}
        symbol={token1Symbol}
        amount={amount1}
        balance={balance1}
        disabled={token0Only}
        onChange={onAmount1Change}
      />
    </div>
  );
}
