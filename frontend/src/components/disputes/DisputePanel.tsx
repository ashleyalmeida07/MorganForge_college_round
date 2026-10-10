"use client";

import React, { useState } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { ShieldAlert, AlertTriangle, CheckCircle2, ExternalLink, Loader2, Scale } from "lucide-react";
import { apiPost, type DisputePrepareOut } from "@/lib/api";
import { getProgram, openDispute, lamportsToSol, shortKey } from "@/lib/solana";
import { explorerTx } from "@/lib/env";

interface DisputePanelProps {
  requestPda: string;
  currentOutputHash?: string | null;
  minDisputeStake?: number | null;
  onDisputed?: () => void;
}

export function DisputePanel({
  requestPda,
  currentOutputHash,
  minDisputeStake = 5_000_000,
  onDisputed,
}: DisputePanelProps) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const [claimedHash, setClaimedHash] = useState("");
  const [status, setStatus] = useState<"idle" | "preparing" | "signing" | "done" | "error">("idle");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cleanClaimed = claimedHash.trim().toLowerCase().replace(/^0x/, "");
  const isValidHex = /^[0-9a-f]{64}$/.test(cleanClaimed);
  const isIdentical = currentOutputHash && cleanClaimed === currentOutputHash.toLowerCase().replace(/^0x/, "");

  const handleDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet) {
      setErrorMsg("Please connect your Solana wallet to open a dispute.");
      return;
    }
    if (!isValidHex) {
      setErrorMsg("Claimed output hash must be exactly 64 hexadecimal characters (32 bytes).");
      return;
    }
    if (isIdentical) {
      setErrorMsg(
        "Claimed hash is identical to the receipt hash. A dispute requires challenging the receipt with a different hash.",
      );
      return;
    }

    setStatus("preparing");
    setErrorMsg(null);
    setWarnings([]);

    try {
      // 1. Prepare dispute via backend validation.
      const prep = await apiPost<DisputePrepareOut>("/disputes/prepare", {
        request_pda: requestPda,
        claimed_output_hash: cleanClaimed,
        challenger: wallet.publicKey.toBase58(),
      });

      if (prep.warnings && prep.warnings.length > 0) {
        setWarnings(prep.warnings);
      }

      // 2. Open dispute on-chain via the Anchor program.
      setStatus("signing");
      const program = getProgram(connection, wallet);
      const reqPubkey = new PublicKey(requestPda);

      const sig = await openDispute(program, reqPubkey, prep.claimed_output_hash_bytes32);
      setTxSig(sig);
      setStatus("done");
      if (onDisputed) onDisputed();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStatus("error");
    }
  };

  const stakeSol = lamportsToSol(minDisputeStake);
  const busy = status === "preparing" || status === "signing";

  return (
    <div className="rounded-2xl border border-red-200 bg-white p-5 sm:p-6 shadow-xs space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-red-600" />
            <h3 className="text-base font-bold text-slate-900">Open a staked dispute</h3>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed max-w-xl">
            Challenge this execution if the output is fraudulent or invalid. This opens a formal on-chain dispute on
            Solana and requires staking <strong className="text-slate-700">{stakeSol} SOL</strong>. If the verifier
            quorum agrees with your claim, the provider is slashed and your stake is returned.
          </p>
        </div>
        <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 font-semibold shrink-0">
          Stake {stakeSol} SOL
        </span>
      </div>

      <form onSubmit={handleDispute} className="space-y-3 pt-1">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-600">Your claimed output hash (32-byte hex)</label>
            {currentOutputHash && (
              <span className="text-[11px] font-mono text-slate-400">
                Receipt: {shortKey(currentOutputHash, 6)}
              </span>
            )}
          </div>
          <input
            type="text"
            placeholder="64 hex characters of the correct SHA-256 output"
            value={claimedHash}
            onChange={(e) => setClaimedHash(e.target.value)}
            disabled={busy || status === "done"}
            className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 disabled:opacity-50"
          />
        </div>

        {warnings.length > 0 && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1 text-xs text-amber-800">
            <div className="flex items-center gap-1.5 font-semibold text-amber-700">
              <AlertTriangle className="w-4 h-4" /> Warning
            </div>
            {warnings.map((w, idx) => (
              <p key={idx} className="leading-relaxed">
                {w}
              </p>
            ))}
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-mono leading-relaxed break-words">
            <span className="font-semibold">Error: </span>
            {errorMsg}
          </div>
        )}

        {status === "done" && txSig && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2 text-xs">
            <div className="flex items-center gap-2 font-bold text-emerald-700">
              <CheckCircle2 className="w-4 h-4" /> Dispute opened on {process.env.NEXT_PUBLIC_CLUSTER ?? "devnet"}
            </div>
            <p className="text-slate-600 leading-relaxed">
              Your dispute is recorded on-chain. Independent verifier quorum attestations will resolve it during the
              challenge window.
            </p>
            <div className="pt-1">
              <a
                href={explorerTx(txSig) || `https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-blue-600 hover:underline"
              >
                View dispute transaction <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="text-[11px] text-slate-400">Frivolous disputes forfeit the stake to the honest provider.</span>
          <button
            type="submit"
            disabled={!wallet || !isValidHex || !!isIdentical || busy || status === "done"}
            className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-xs font-bold text-white transition flex items-center gap-2 shadow-xs"
          >
            {status === "preparing" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying with network&hellip;
              </>
            ) : status === "signing" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sign in wallet&hellip;
              </>
            ) : status === "done" ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" /> Dispute live
              </>
            ) : (
              <>
                <ShieldAlert className="w-3.5 h-3.5" /> Stake {stakeSol} SOL &amp; open dispute
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default DisputePanel;
