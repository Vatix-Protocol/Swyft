"use client";

interface Props {
  impact: number; // percentage 0–100
}

export function PriceImpactBadge({ impact }: Props) {
  const label = `${impact.toFixed(2)}%`;

  if (impact < 1) {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">
        {label}
      </span>
    );
  }
  if (impact < 5) {
    return (
      <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400">
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
      {label}
    </span>
  );
}
