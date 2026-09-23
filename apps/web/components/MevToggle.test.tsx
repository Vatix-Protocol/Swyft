/**
 * Test suite for MevToggle.
 *
 * Regression coverage for #821: the tooltip previously claimed transaction
 * details were "hidden" until finalized (a private-mempool / bundle-relay
 * claim). No such mechanism exists in this codebase — MEV protection only
 * routes the swap through an alternate RPC endpoint (see
 * apps/web/lib/mev-submission.ts and apps/web/hooks/useMevProtection.ts).
 * These tests assert the copy no longer makes that false claim and instead
 * describes the real RPC-routing behavior.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MevToggle } from './MevToggle';

function getInfoTooltip() {
  return screen.getByLabelText('What is MEV protection?');
}

describe('MevToggle — copy accuracy', () => {
  it('renders the MEV Protection label', () => {
    render(<MevToggle />);
    expect(screen.getByText('MEV Protection')).toBeInTheDocument();
  });

  it('does not claim transactions are hidden from the mempool', () => {
    render(<MevToggle />);
    const tooltip = getInfoTooltip().getAttribute('title') ?? '';

    expect(tooltip.toLowerCase()).not.toContain('hidden');
    expect(tooltip.toLowerCase()).not.toContain('hides');
    expect(tooltip.toLowerCase()).not.toMatch(/private mempool|bundle|flashbots/);
  });

  it('describes MEV protection as routing through a different RPC endpoint', () => {
    render(<MevToggle />);
    const tooltip = getInfoTooltip().getAttribute('title') ?? '';

    expect(tooltip.toLowerCase()).toContain('rpc endpoint');
  });

  it('explicitly disclaims hiding the transaction from the network', () => {
    render(<MevToggle />);
    const tooltip = getInfoTooltip().getAttribute('title') ?? '';

    expect(tooltip.toLowerCase()).toContain('does not hide your transaction');
  });

  it('still communicates the confirmation-time trade-off', () => {
    render(<MevToggle />);
    const tooltip = getInfoTooltip().getAttribute('title') ?? '';

    expect(tooltip).toMatch(/slower confirmation/i);
  });

  it('renders a toggle switch', () => {
    render(<MevToggle />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });
});
