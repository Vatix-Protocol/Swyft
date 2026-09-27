/**
 * In-process counter whose label set is fixed at construction time.
 *
 * Labels are never derived from request data (wallets, job ids, error
 * messages, keys), so the number of series is bounded no matter what an
 * adversarial client sends. Unknown labels are folded into `other` rather
 * than creating a new series.
 */
export class BoundedCounter<L extends string> {
  private readonly counts = new Map<L | 'other', number>();

  constructor(
    readonly name: string,
    labels: readonly L[],
  ) {
    for (const label of labels) {
      this.counts.set(label, 0);
    }
    this.counts.set('other', 0);
  }

  inc(label: L): void {
    const key: L | 'other' = this.counts.has(label) ? label : 'other';
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  /** Test helper: zero every series without changing the label set. */
  reset(): void {
    for (const key of this.counts.keys()) {
      this.counts.set(key, 0);
    }
  }
}
