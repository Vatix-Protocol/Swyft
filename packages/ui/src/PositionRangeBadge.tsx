"use client";

interface Props {
  status: "in-range" | "out-of-range" | "closed";
}

export function PositionRangeBadge({ status }: Props) {
  if (status === "in-range") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
        In range
      </span>
    );
  }
  if (status === "out-of-range") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400">
        <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" aria-hidden="true" />
        Out of range
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" aria-hidden="true" />
      Closed
    </span>
  );
}
