/**
 * Smoke tests that verify Button and Input are properly exported from
 * the @swyft/ui package entry point.
 *
 * These tests are intentionally lightweight — they confirm the public API
 * surface resolves correctly so that downstream consumers (apps/web) don't
 * hit missing-export errors at build time.
 */
import * as SwyftUI from '../index';

describe('@swyft/ui exports', () => {
  // ── Primitives ─────────────────────────────────────────────────────────────

  it('exports Button as a function', () => {
    expect(typeof SwyftUI.Button).toBe('function');
  });

  it('exports Input as a function', () => {
    expect(typeof SwyftUI.Input).toBe('function');
  });

  // ── Existing domain components still exported ──────────────────────────────

  it('still exports TokenLogo', () => {
    expect(typeof SwyftUI.TokenLogo).toBe('function');
  });

  it('still exports SwapInput', () => {
    expect(typeof SwyftUI.SwapInput).toBe('function');
  });

  it('still exports SlippagePanel', () => {
    expect(typeof SwyftUI.SlippagePanel).toBe('function');
  });

  it('still exports TokenSelector', () => {
    expect(typeof SwyftUI.TokenSelector).toBe('function');
  });

  it('still exports TokenSelectorModal', () => {
    expect(typeof SwyftUI.TokenSelectorModal).toBe('function');
  });

  it('still exports PositionRangeBadge', () => {
    expect(typeof SwyftUI.PositionRangeBadge).toBe('function');
  });

  it('still exports PriceImpactBadge', () => {
    expect(typeof SwyftUI.PriceImpactBadge).toBe('function');
  });

  it('still exports TokenPairSelector', () => {
    expect(typeof SwyftUI.TokenPairSelector).toBe('function');
  });
});
