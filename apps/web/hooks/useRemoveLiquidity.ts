"use client";

import { useState } from "react";
import { signTransaction } from "@stellar/freighter-api";
import { buildBurnTx, buildCollectTx } from "@swyft/sdk";
import type { PositionSnapshot } from "@swyft/ui";
import { API_BASE, SWYFT_NETWORK } from "@/lib/constants";

export type TxStatus = "idle" | "signing" | "submitting" | "success" | "error";
export type TxError = "rejected" | "network" | "already_closed" | null;

interface State {
  status: TxStatus;
  txError: TxError;
  txHash: string | null;
}

async function submitXdr(xdr: string, authToken: string): Promise<string> {
  const res = await fetch(`${API_BASE}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ xdr }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === "POSITION_CLOSED") throw new Error("already_closed");
    throw new Error("network");
  }
  const data = (await res.json()) as { hash: string };
  return data.hash;
}

export function useRemoveLiquidity(position: PositionSnapshot | null, authToken: string | null) {
  const [state, setState] = useState<State>({ status: "idle", txError: null, txHash: null });

  function reset() {
    setState({ status: "idle", txError: null, txHash: null });
  }

  async function removeLiquidity(pct: number) {
    if (!position || !authToken) return;
    setState({ status: "signing", txError: null, txHash: null });

    try {
      const { xdr } = buildBurnTx({
        positionId: position.id,
        poolId: position.poolId,
        liquidityBps: Math.round(pct * 100),
        ownerAddress: position.ownerWallet,
      });

      const signResult = await signTransaction(xdr, { network: SWYFT_NETWORK });
      const signedXdr = typeof signResult === "string" ? signResult
        : "signedTxXdr" in signResult ? (signResult as { signedTxXdr: string }).signedTxXdr
        : null;

      if (!signedXdr) { setState({ status: "error", txError: "rejected", txHash: null }); return; }

      setState((s) => ({ ...s, status: "submitting" }));
      const hash = await submitXdr(signedXdr, authToken);
      setState({ status: "success", txError: null, txHash: hash });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      const txError: TxError =
        msg === "already_closed" ? "already_closed"
        : msg.includes("reject") || msg.includes("cancel") ? "rejected"
        : "network";
      setState({ status: "error", txError, txHash: null });
    }
  }

  async function collectFees() {
    if (!position || !authToken) return;
    setState({ status: "signing", txError: null, txHash: null });

    try {
      const { xdr } = buildCollectTx({
        positionId: position.id,
        poolId: position.poolId,
        ownerAddress: position.ownerWallet,
      });

      const signResult = await signTransaction(xdr, { network: SWYFT_NETWORK });
      const signedXdr = typeof signResult === "string" ? signResult
        : "signedTxXdr" in signResult ? (signResult as { signedTxXdr: string }).signedTxXdr
        : null;

      if (!signedXdr) { setState({ status: "error", txError: "rejected", txHash: null }); return; }

      setState((s) => ({ ...s, status: "submitting" }));
      const hash = await submitXdr(signedXdr, authToken);
      setState({ status: "success", txError: null, txHash: hash });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      const txError: TxError = msg === "already_closed" ? "already_closed"
        : msg.includes("reject") || msg.includes("cancel") ? "rejected"
        : "network";
      setState({ status: "error", txError, txHash: null });
    }
  }

  return { ...state, removeLiquidity, collectFees, reset };
}
