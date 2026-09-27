'use client';

import { tw } from './tokens';

interface Props {
  status: 'in-range' | 'out-of-range' | 'closed';
}

export function PositionRangeBadge({ status }: Props) {
  if (status === 'in-range') {
    return (
      <span className={tw.badge.success}>
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
        In range
      </span>
    );
  }
  if (status === 'out-of-range') {
    return (
      <span className={tw.badge.warning}>
        <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" aria-hidden="true" />
        Out of range
      </span>
    );
  }
  return (
    <span className={tw.badge.neutral}>
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" aria-hidden="true" />
      Closed
    </span>
  );
}
