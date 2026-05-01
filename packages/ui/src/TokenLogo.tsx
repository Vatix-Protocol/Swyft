"use client";

import { Token } from "./types";

const COLORS = ["bg-indigo-500", "bg-violet-500", "bg-pink-500", "bg-teal-500", "bg-amber-500"];

function colorFor(symbol: string) {
  let n = 0;
  for (let i = 0; i < symbol.length; i++) n += symbol.charCodeAt(i);
  return COLORS[n % COLORS.length];
}

export function TokenLogo({ token, size = 24 }: { token: Token; size?: number }) {
  if (token.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={token.logoUrl} alt={token.symbol} width={size} height={size}
        className="rounded-full object-cover" style={{ width: size, height: size }} />
    );
  }
  return (
    <span aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-full text-white font-bold ${colorFor(token.symbol)}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {token.symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}
