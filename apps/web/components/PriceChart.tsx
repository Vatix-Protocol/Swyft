"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { usePriceCandles, type Interval, type Candle } from "@/hooks/usePriceCandles";

const INTERVALS: Interval[] = ["1m", "5m", "1h", "1d"];
const PADDING = { top: 16, right: 64, bottom: 28, left: 8 };
const CANDLE_GAP = 1;

interface Tooltip {
  x: number;
  y: number;
  candle: Candle;
}

function formatTime(ts: number, interval: Interval) {
  const d = new Date(ts * 1000);
  if (interval === "1d") return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function drawChart(
  canvas: HTMLCanvasElement,
  candles: Candle[],
  currentPrice: number | null,
  isDark: boolean
) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const colors = {
    bg: isDark ? "#18181b" : "#ffffff",
    grid: isDark ? "#27272a" : "#f4f4f5",
    text: isDark ? "#71717a" : "#a1a1aa",
    up: "#22c55e",
    down: "#ef4444",
    priceLine: "#6366f1",
    priceLabel: isDark ? "#e0e7ff" : "#4338ca",
  };

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);

  if (candles.length === 0) return;

  const chartW = W - PADDING.left - PADDING.right;
  const chartH = H - PADDING.top - PADDING.bottom;

  const allLow = Math.min(...candles.map((c) => c.low));
  const allHigh = Math.max(...candles.map((c) => c.high));
  const priceRange = allHigh - allLow || 1;
  const pricePad = priceRange * 0.05;
  const minP = allLow - pricePad;
  const maxP = allHigh + pricePad;
  const totalRange = maxP - minP;

  function toY(price: number) {
    return PADDING.top + chartH * (1 - (price - minP) / totalRange);
  }

  const candleW = Math.max(1, chartW / candles.length - CANDLE_GAP);

  // Grid lines (4 horizontal)
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PADDING.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(W - PADDING.right, y);
    ctx.stroke();

    const price = maxP - (totalRange / 4) * i;
    ctx.fillStyle = colors.text;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(price.toFixed(price < 1 ? 6 : 2), W - PADDING.right + 4, y + 3);
  }

  // Candles
  candles.forEach((c, i) => {
    const x = PADDING.left + i * (candleW + CANDLE_GAP);
    const isUp = c.close >= c.open;
    const color = isUp ? colors.up : colors.down;

    const bodyTop = toY(Math.max(c.open, c.close));
    const bodyBot = toY(Math.min(c.open, c.close));
    const bodyH = Math.max(1, bodyBot - bodyTop);
    const cx = x + candleW / 2;

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, toY(c.high));
    ctx.lineTo(cx, toY(c.low));
    ctx.stroke();

    // Body
    ctx.fillStyle = color;
    ctx.fillRect(x, bodyTop, candleW, bodyH);
  });

  // Current price line
  if (currentPrice !== null) {
    const py = toY(currentPrice);
    ctx.strokeStyle = colors.priceLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, py);
    ctx.lineTo(W - PADDING.right, py);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price label
    const label = currentPrice.toFixed(currentPrice < 1 ? 6 : 2);
    const labelW = label.length * 6.5 + 8;
    ctx.fillStyle = colors.priceLine;
    ctx.fillRect(W - PADDING.right + 2, py - 8, labelW, 16);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, W - PADDING.right + 6, py + 3.5);
  }
}

interface Props {
  tokenA: string | null;
  tokenB: string | null;
  tokenASymbol?: string;
  tokenBSymbol?: string;
}

export function PriceChart({ tokenA, tokenB, tokenASymbol, tokenBSymbol }: Props) {
  const [interval, setInterval] = useState<Interval>("1h");
  const { candles, loading, currentPrice } = usePriceCandles(tokenA, tokenB, interval);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  const redraw = useCallback(() => {
    if (canvasRef.current) drawChart(canvasRef.current, candles, currentPrice, isDark);
  }, [candles, currentPrice, isDark]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Redraw on resize
  useEffect(() => {
    const ro = new ResizeObserver(redraw);
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [redraw]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!canvasRef.current || candles.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const chartW = rect.width - PADDING.left - PADDING.right;
    const candleW = chartW / candles.length;
    const idx = Math.floor((mx - PADDING.left) / candleW);
    if (idx < 0 || idx >= candles.length) { setTooltip(null); return; }
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, candle: candles[idx] });
  }

  function handleTouch(e: React.TouchEvent<HTMLCanvasElement>) {
    if (!canvasRef.current || candles.length === 0 || e.touches.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.touches[0].clientX - rect.left;
    const chartW = rect.width - PADDING.left - PADDING.right;
    const candleW = chartW / candles.length;
    const idx = Math.floor((mx - PADDING.left) / candleW);
    if (idx < 0 || idx >= candles.length) { setTooltip(null); return; }
    setTooltip({ x: mx, y: e.touches[0].clientY - rect.top, candle: candles[idx] });
  }

  const pairLabel = tokenASymbol && tokenBSymbol
    ? `${tokenASymbol} / ${tokenBSymbol}`
    : tokenA && tokenB
    ? `${tokenA.slice(0, 4)} / ${tokenB.slice(0, 4)}`
    : null;

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <p className="text-sm font-semibold text-zinc-900 dark:text-white">
          {pairLabel ?? "Price chart"}
          {currentPrice !== null && (
            <span className="ml-2 text-indigo-600 dark:text-indigo-400 font-mono text-xs">
              {currentPrice.toFixed(currentPrice < 1 ? 6 : 4)}
            </span>
          )}
        </p>
        <div className="flex gap-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              className={`min-h-[44px] min-w-[44px] rounded-lg px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                interval === iv
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {iv}
            </button>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div className="relative w-full h-[160px] sm:h-[220px]">
        {/* Loading skeleton */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-zinc-900 z-10">
            <div className="flex gap-1 items-end h-16 px-4 w-full">
              {Array.from({ length: 24 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-zinc-100 dark:bg-zinc-800 animate-pulse"
                  style={{ height: `${30 + Math.sin(i * 0.8) * 20 + 20}%` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && candles.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 z-10">
            <p className="text-sm text-zinc-400">No price history</p>
            <p className="text-xs text-zinc-300 dark:text-zinc-600">
              Data will appear once trades occur
            </p>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="w-full h-full block touch-pan-y"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
          onTouchMove={handleTouch}
          onTouchEnd={() => setTooltip(null)}
          aria-label="OHLCV candlestick chart"
        />

        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900/95"
            style={{
              left: tooltip.x > 200 ? tooltip.x - 140 : tooltip.x + 12,
              top: Math.max(4, tooltip.y - 60),
            }}
          >
            <p className="font-medium text-zinc-500 mb-1.5">
              {formatTime(tooltip.candle.time, interval)}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums">
              <span className="text-zinc-400">O</span>
              <span className="text-zinc-800 dark:text-zinc-200">{tooltip.candle.open.toFixed(6)}</span>
              <span className="text-zinc-400">H</span>
              <span className="text-green-600">{tooltip.candle.high.toFixed(6)}</span>
              <span className="text-zinc-400">L</span>
              <span className="text-red-500">{tooltip.candle.low.toFixed(6)}</span>
              <span className="text-zinc-400">C</span>
              <span className="text-zinc-800 dark:text-zinc-200">{tooltip.candle.close.toFixed(6)}</span>
              <span className="text-zinc-400">Vol</span>
              <span className="text-zinc-800 dark:text-zinc-200">
                {tooltip.candle.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
