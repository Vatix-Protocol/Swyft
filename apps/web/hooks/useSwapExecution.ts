"use client";

import { useState } from "react";
import { signTransaction } from "@stellar/freighter-api";
import { buildSwapTx } from "@swyft/sdk";
import type { SwapQuote } from "@swyft/sdk";
import type { Token } from "@swyft/ui";
import { API_BASE, SWYFT_NETWORK } from "@/lib/constants";

export type SwapStatus = "idle" | "signing" | "submitting" | "success" | "error";
export type SwapError = "rejected" | "slippage" | "network" | null;

interface SwapResult {
  status: SwapStatus;
  error: SwapError;
  txHash: string | null;
}

interface ExecuteParams {
  poolId: string;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: string;
  quote: SwapQuote;
  walletAddress: string;
}

export function useSwapExecution() {
  const [result, setResult] = useState<SwapResult>({
    status: "idle",
    error: null,
    txHash: null,
  });

  function reset() {
    setResult({ status: "idle", error: null, txHash: null });
  }

  async function execute(params: ExecuteParams) {
    const { poolId, tokenIn, tokenOut, amountIn, quote, walletAddress } = params;

    setResult({ status: "signing", error: null, txHash: null });

    try {
      const { xdr } = buildSwapTx({
        poolId,
        tokenInId: tokenIn.id,
        tokenOutId: tokenOut.id,
        amountIn,
        minimumReceived: quote.minimumReceived,
        ownerAddress: walletAddress,
      });

      const signResult = await signTransaction(xdr, { network: SWYFT_NETWORK });
      const signedXdr =
        typeof signResult === "string"
          ? signResult
          : "signedTxXdr" in signResult
          ? (signResult as { signedTxXdr: string }).signedTxXdr
          : null;

      if (!signedXdr) {
        setResult({ status: "idle", error: null, txHash: null });
        return;
      }

      setResult({ status: "submitting", error: null, txHash: null });

      const res = await fetch(`${API_BASE}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xdr: signedXdr }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        const error: SwapError =
          body.code === "SLIPPAGE_EXCEEDED" ? "slippage" : "network";
        setResult({ status: "error", error, txHash: null });
        return;
      }

      const data = (await res.json()) as { hash: string };
      setResult({ status: "success", error: null, txHash: data.hash });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("reject") || msg.includes("cancel") || msg.includes("denied")) {
        // User rejected in wallet — close silently
        setResult({ status: "idle", error: null, txHash: null });
        return;
      }
      setResult({ status: "error", error: "network", txHash: null });
    }
  }

  return { ...result, execute, reset };
}
