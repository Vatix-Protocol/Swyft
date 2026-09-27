'use client';

import { tw } from './tokens';

interface Props {
  impact: number; // percentage 0–100
}

export function PriceImpactBadge({ impact }: Props) {
  const label = `${impact.toFixed(2)}%`;

  if (impact < 1) {
    return <span className={tw.badge.success}>{label}</span>;
  }
  if (impact < 5) {
    return <span className={tw.badge.warning}>{label}</span>;
  }
  return <span className={tw.badge.danger}>{label}</span>;
}
