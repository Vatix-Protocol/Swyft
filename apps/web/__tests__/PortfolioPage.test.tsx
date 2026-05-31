/**
 * Tests for apps/web/app/portfolio/page.tsx
 *
 * Strategy:
 * - Mock all external hooks and modules so tests are pure unit tests
 * - Cover: redirect when no wallet, loading state, empty state, position list,
 *   show/hide closed positions toggle, collect-fees interaction
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { PositionSnapshot } from "@swyft/ui";

// ─── Module mocks ────────────────────────────────────────────────────────────

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mockRefresh = vi.fn();
const mockUsePortfolio = vi.fn();

vi.mock("@/hooks/usePortfolio", () => ({
  usePortfolio: (...args: unknown[]) => mockUsePortfolio(...args),
}));

const mockUseWalletContext = vi.fn();

vi.mock("@/context/WalletContext", () => ({
  useWalletContext: () => mockUseWalletContext(),
}));

// PositionCard is a child component — render a lightweight stub so tests stay
// focused on PortfolioPage behaviour rather than card internals.
vi.mock("@/components/PositionCard", () => ({
  PositionCard: ({
    position,
    onCollectFees,
    collecting,
  }: {
    position: PositionSnapshot;
    onCollectFees: (id: string) => void;
    collecting: boolean;
  }) => (
    <div data-testid={`position-card-${position.id}`}>
      <span>{position.id}</span>
      <button
        onClick={() => onCollectFees(position.id)}
        disabled={collecting}
        data-testid={`collect-${position.id}`}
      >
        {collecting ? "Collecting…" : "Collect fees"}
      </button>
    </div>
  ),
}));

// Freighter API — not exercised in these unit tests
vi.mock("@stellar/freighter-api", () => ({
  signTransaction: vi.fn(),
}));

// @swyft/sdk — not exercised in these unit tests
vi.mock("@swyft/sdk", () => ({
  buildCollectTx: vi.fn(() => ({ xdr: "mock-xdr" })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePosition(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    id: "pos-1",
    ownerWallet: "GTEST",
    poolId: "pool-xlm-usdc",
    token0: "XLM",
    token1: "USDC",
    lowerTick: -1000,
    upperTick: 1000,
    liquidity: "1000000",
    currentValueUsd: 500,
    uncollectedFeesToken0: "1.5",
    uncollectedFeesToken1: "0.5",
    createdAt: 1_700_000_000,
    closedAt: null,
    status: "active",
    poolCurrentPrice: 0.1085,
    ...overrides,
  };
}

// Lazy import so mocks are registered before the module is evaluated
async function importPage() {
  const mod = await import("../app/portfolio/page");
  return mod.default;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PortfolioPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: wallet connected, not loading, no positions
    mockUseWalletContext.mockReturnValue({ address: "GTEST123", signTransaction: vi.fn() });
    mockUsePortfolio.mockReturnValue({
      active: [],
      closed: [],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 0,
    });
    // Silence localStorage in jsdom
    Object.defineProperty(window, "localStorage", {
      value: { getItem: vi.fn(() => "mock-token"), setItem: vi.fn(), removeItem: vi.fn() },
      writable: true,
    });
  });

  // ── Redirect ──────────────────────────────────────────────────────────────

  it("redirects to / when wallet is not connected and not loading", async () => {
    mockUseWalletContext.mockReturnValue({ address: null, signTransaction: null });
    mockUsePortfolio.mockReturnValue({
      active: [],
      closed: [],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 0,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("does not redirect while loading even if address is null", async () => {
    mockUseWalletContext.mockReturnValue({ address: null, signTransaction: null });
    mockUsePortfolio.mockReturnValue({
      active: [],
      closed: [],
      loading: true,
      refresh: mockRefresh,
      totalValueUsd: 0,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    // Give any async effects a chance to run
    await waitFor(() => {
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  it("shows a loading spinner when loading and no positions are present", async () => {
    mockUsePortfolio.mockReturnValue({
      active: [],
      closed: [],
      loading: true,
      refresh: mockRefresh,
      totalValueUsd: 0,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  it("does not show the loading spinner once loading is complete", async () => {
    mockUsePortfolio.mockReturnValue({
      active: [],
      closed: [],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 0,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    expect(screen.queryByLabelText("Loading")).not.toBeInTheDocument();
  });

  // ── Empty state ───────────────────────────────────────────────────────────

  it("shows the empty state message when there are no positions", async () => {
    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    expect(screen.getByText("You have no active positions yet.")).toBeInTheDocument();
    expect(screen.getByText("Add liquidity to a pool to get started.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse pools" })).toBeInTheDocument();
  });

  it("keeps a first-position next step when showing all positions with no data", async () => {
    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    const toggle = screen.getByRole("switch", { name: /show closed/i });
    fireEvent.click(toggle);

    expect(screen.getByText("You have no positions yet.")).toBeInTheDocument();
    expect(screen.getByText("Add liquidity to a pool to create your first position.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse pools" })).toBeInTheDocument();
  });

  it("explains the next step when there are closed positions but no active positions", async () => {
    const closedPos = makePosition({ id: "pos-closed", status: "closed", closedAt: 1_700_000_000 });
    mockUsePortfolio.mockReturnValue({
      active: [],
      closed: [closedPos],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 0,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    expect(screen.getByText("No active positions found.")).toBeInTheDocument();
    expect(screen.getByText("Add liquidity to open a new position, or show closed positions to review past ones.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse pools" })).toBeInTheDocument();
  });

  // ── Portfolio summary ─────────────────────────────────────────────────────

  it("displays the total portfolio value", async () => {
    mockUsePortfolio.mockReturnValue({
      active: [makePosition({ currentValueUsd: 1234.56 })],
      closed: [],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 1234.56,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    expect(screen.getByText("$1,234.56")).toBeInTheDocument();
  });

  it("shows the correct active position count in the summary", async () => {
    const positions = [
      makePosition({ id: "pos-1" }),
      makePosition({ id: "pos-2" }),
    ];
    mockUsePortfolio.mockReturnValue({
      active: positions,
      closed: [],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 1000,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    expect(screen.getByText("2 active positions")).toBeInTheDocument();
  });

  it("uses singular 'position' when there is exactly 1 active position", async () => {
    mockUsePortfolio.mockReturnValue({
      active: [makePosition()],
      closed: [],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 500,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    expect(screen.getByText("1 active position")).toBeInTheDocument();
  });

  // ── Position list ─────────────────────────────────────────────────────────

  it("renders a card for each active position", async () => {
    const positions = [
      makePosition({ id: "pos-1" }),
      makePosition({ id: "pos-2" }),
      makePosition({ id: "pos-3" }),
    ];
    mockUsePortfolio.mockReturnValue({
      active: positions,
      closed: [],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 1500,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    expect(screen.getByTestId("position-card-pos-1")).toBeInTheDocument();
    expect(screen.getByTestId("position-card-pos-2")).toBeInTheDocument();
    expect(screen.getByTestId("position-card-pos-3")).toBeInTheDocument();
  });

  it("does not render closed positions by default", async () => {
    const closedPos = makePosition({ id: "pos-closed", status: "closed", closedAt: 1_700_000_000 });
    mockUsePortfolio.mockReturnValue({
      active: [makePosition({ id: "pos-active" })],
      closed: [closedPos],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 500,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    expect(screen.getByTestId("position-card-pos-active")).toBeInTheDocument();
    expect(screen.queryByTestId("position-card-pos-closed")).not.toBeInTheDocument();
  });

  // ── Show closed toggle ────────────────────────────────────────────────────

  it("shows closed positions after toggling 'Show closed'", async () => {
    const closedPos = makePosition({ id: "pos-closed", status: "closed", closedAt: 1_700_000_000 });
    mockUsePortfolio.mockReturnValue({
      active: [makePosition({ id: "pos-active" })],
      closed: [closedPos],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 500,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    const toggle = screen.getByRole("switch", { name: /show closed/i });
    fireEvent.click(toggle);

    expect(screen.getByTestId("position-card-pos-active")).toBeInTheDocument();
    expect(screen.getByTestId("position-card-pos-closed")).toBeInTheDocument();
  });

  it("updates the heading to 'All positions' when show-closed is on", async () => {
    mockUsePortfolio.mockReturnValue({
      active: [makePosition()],
      closed: [],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 500,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    expect(screen.getByText("Active positions")).toBeInTheDocument();

    const toggle = screen.getByRole("switch", { name: /show closed/i });
    fireEvent.click(toggle);

    expect(screen.getByText("All positions")).toBeInTheDocument();
  });

  it("hides closed positions again after toggling twice", async () => {
    const closedPos = makePosition({ id: "pos-closed", status: "closed", closedAt: 1_700_000_000 });
    mockUsePortfolio.mockReturnValue({
      active: [makePosition({ id: "pos-active" })],
      closed: [closedPos],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 500,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    const toggle = screen.getByRole("switch", { name: /show closed/i });
    fireEvent.click(toggle); // show closed
    fireEvent.click(toggle); // hide closed again

    expect(screen.queryByTestId("position-card-pos-closed")).not.toBeInTheDocument();
  });

  // ── Collect fees ──────────────────────────────────────────────────────────

  it("marks the position as collecting while the fee collection is in progress", async () => {
    // Make the collect call hang so we can observe the in-progress state
    const { buildCollectTx } = await import("@swyft/sdk");
    (buildCollectTx as ReturnType<typeof vi.fn>).mockReturnValue({ xdr: "mock-xdr" });

    const { signTransaction } = await import("@stellar/freighter-api");
    (signTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    const position = makePosition({ id: "pos-1" });
    mockUsePortfolio.mockReturnValue({
      active: [position],
      closed: [],
      loading: false,
      refresh: mockRefresh,
      totalValueUsd: 500,
    });

    const PortfolioPage = await importPage();
    render(<PortfolioPage />);

    const collectBtn = screen.getByTestId("collect-pos-1");
    fireEvent.click(collectBtn);

    await waitFor(() => {
      expect(collectBtn).toBeDisabled();
    });
  });
});
