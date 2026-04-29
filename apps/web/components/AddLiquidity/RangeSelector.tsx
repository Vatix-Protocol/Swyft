"use client";

import { useRef, useCallback, useMemo } from "react";
import type { TickData } from "@/hooks/usePoolTicks";
import { tickToPrice, priceToTick, nearestUsableTick } from "@/hooks/useAddLiquidity";

interface Props {
  ticks: TickData[];
  currentTick: number;
  lowerTick: number;
  upperTick: number;
  tickSpacing?: number;
  token0Symbol: string;
  token1Symbol: string;
  lowerPrice: string;
  upperPrice: string;
  onLowerTickChange: (tick: number) => void;
  onUpperTickChange: (tick: number) => void;
  onLowerPriceChange: (price: string) => void;
  onUpperPriceChange: (price: string) => void;
  onFullRange: () => void;
  isFullRange: boolean;
}

const CHART_H = 100;
const CHART_W = 100; // percentage units

export function RangeSelector({
  ticks,
  currentTick,
  lowerTick,
  upperTick,
  tickSpacing = 60,
  token0Symbol,
  token1Symbol,
  lowerPrice,
  upperPrice,
  onLowerTickChange,
  onUpperTickChange,
  onLowerPriceChange,
  onUpperPriceChange,
  onFullRange,
  isFullRange,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<"lower" | "upper" | null>(null);

  const { bars, minTick, maxTick } = useMemo(() => {
    if (!ticks.length) return { bars: [], minTick: -2000, maxTick: 2000 };
    const sorted = [...ticks].sort((a, b) => a.tick - b.tick);
    const minT = sorted[0].tick;
    const maxT = sorted[sorted.length - 1].tick;
    const maxLiq = Math.max(...sorted.map((t) => parseFloat(t.liquidityGross) || 0), 1);
    const bars = sorted.map((t) => ({
      tick: t.tick,
      x: ((t.tick - minT) / (maxT - minT)) * CHART_W,
      h: (parseFloat(t.liquidityGross) / maxLiq) * CHART_H,
      active: t.tick >= lowerTick && t.tick <= upperTick,
    }));
    return { bars, minTick: minT, maxTick: maxT };
  }, [ticks, lowerTick, upperTick]);

  const tickToX = useCallback((tick: number) => {
    if (maxTick === minTick) return 50;
    return Math.max(0, Math.min(100, ((tick - minTick) / (maxTick - minTick)) * 100));
  }, [minTick, maxTick]);

  const xToTick = useCallback((xPct: number) => {
    const tick = minTick + (xPct / 100) * (maxTick - minTick);
    return nearestUsableTick(Math.round(tick), tickSpacing);
  }, [minTick, maxTick, tickSpacing]);

  const getSvgX = useCallback((clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const onMouseDown = useCallback((handle: "lower" | "upper") => (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = handle;

    const onMove = (me: MouseEvent) => {
      const xPct = getSvgX(me.clientX);
      const tick = xToTick(xPct);
      if (handle === "lower" && tick < upperTick) onLowerTickChange(tick);
      if (handle === "upper" && tick > lowerTick) onUpperTickChange(tick);
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [getSvgX, xToTick, lowerTick, upperTick, onLowerTickChange, onUpperTickChange]);

  const lowerX = tickToX(lowerTick);
  const upperX = tickToX(upperTick);
  const currentX = tickToX(currentTick);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Price range</p>
        <button
          type="button"
          onClick={onFullRange}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            isFullRange
              ? "bg-indigo-600 text-white"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          }`}
        >
          Full range
        </button>
      </div>

      {/* Depth chart */}
      <div className="relative rounded-xl border border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50 overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 100 ${CHART_H}`}
          preserveAspectRatio="none"
          className="h-24 w-full cursor-crosshair select-none"
          aria-label="Liquidity depth chart"
        >
          {/* Out-of-range fill */}
          <rect x="0" y="0" width={lowerX} height={CHART_H} fill="currentColor" className="text-zinc-200 dark:text-zinc-800" />
          <rect x={upperX} y="0" width={100 - upperX} height={CHART_H} fill="currentColor" className="text-zinc-200 dark:text-zinc-800" />

          {/* Bars */}
          {bars.map((bar) => (
            <rect
              key={bar.tick}
              x={bar.x}
              y={CHART_H - bar.h}
              width={Math.max(0.4, CHART_W / bars.length - 0.2)}
              height={bar.h}
              fill={bar.active ? "rgb(99,102,241)" : "rgb(161,161,170)"}
              opacity={bar.active ? 0.85 : 0.35}
            />
          ))}

          {/* Selected range fill */}
          <rect
            x={lowerX}
            y="0"
            width={upperX - lowerX}
            height={CHART_H}
            fill="rgb(99,102,241)"
            opacity={0.08}
          />

          {/* Current price line */}
          <line
            x1={currentX}
            y1="0"
            x2={currentX}
            y2={CHART_H}
            stroke="rgb(234,179,8)"
            strokeWidth="0.6"
            strokeDasharray="2,1"
          />

          {/* Lower handle */}
          <g onMouseDown={onMouseDown("lower")} className="cursor-ew-resize">
            <line x1={lowerX} y1="0" x2={lowerX} y2={CHART_H} stroke="rgb(99,102,241)" strokeWidth="0.8" />
            <rect x={lowerX - 2} y={CHART_H - 16} width={4} height={12} rx="1" fill="rgb(99,102,241)" />
          </g>

          {/* Upper handle */}
          <g onMouseDown={onMouseDown("upper")} className="cursor-ew-resize">
            <line x1={upperX} y1="0" x2={upperX} y2={CHART_H} stroke="rgb(99,102,241)" strokeWidth="0.8" />
            <rect x={upperX - 2} y={CHART_H - 16} width={4} height={12} rx="1" fill="rgb(99,102,241)" />
          </g>
        </svg>

        {/* Current price label */}
        <div
          className="pointer-events-none absolute top-1 flex -translate-x-1/2 items-center gap-1 rounded bg-yellow-100 px-1.5 py-0.5 text-[9px] font-semibold text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400"
          style={{ left: `${currentX}%` }}
        >
          Current
        </div>
      </div>

      {/* Manual price inputs */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-1 text-[10px] font-medium text-zinc-400">Min price</p>
          <input
            type="text"
            inputMode="decimal"
            value={lowerPrice}
            onChange={(e) => onLowerPriceChange(e.target.value)}
            aria-label="Minimum price"
            placeholder="0.00"
            className="w-full bg-transparent text-sm font-semibold text-zinc-900 placeholder-zinc-300 focus:outline-none dark:text-white dark:placeholder-zinc-600"
          />
          <p className="mt-0.5 text-[10px] text-zinc-400">{token1Symbol} per {token0Symbol}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-1 text-[10px] font-medium text-zinc-400">Max price</p>
          <input
            type="text"
            inputMode="decimal"
            value={upperPrice}
            onChange={(e) => onUpperPriceChange(e.target.value)}
            aria-label="Maximum price"
            placeholder="0.00"
            className="w-full bg-transparent text-sm font-semibold text-zinc-900 placeholder-zinc-300 focus:outline-none dark:text-white dark:placeholder-zinc-600"
          />
          <p className="mt-0.5 text-[10px] text-zinc-400">{token1Symbol} per {token0Symbol}</p>
        </div>
      </div>
    </div>
  );
}
