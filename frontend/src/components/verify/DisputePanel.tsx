"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Gavel, Loader2, Sparkles, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api";
import { explorerTx } from "@/lib/env";
import { fromHex } from "@/lib/hash";
import { useVerityProgram } from "@/lib/hooks";
import { lamportsToSol, openDispute } from "@/lib/solana";

import type { ChainDispute, ChallengeInfo, DisputeRow } from "./types";
import { errorMessage, ExtLink, fmtDuration, HashValue, normHex, Panel, Pill } from "./ui";

const HEX64 = /^[0-9a-f]{64}$/;

function useCountdown(endsAt?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  return Number.isNaN(end) ? null : Math.max(0, Math.round((end - now) / 1000));
}

function ExistingDispute({ pda, dispute, chainDispute }: { pda: string; dispute: DisputeRow | null; chainDispute: ChainDispute | null }) {
  const [ai, setAi] = useState<string | null>(dispute?.ai_explanation ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const challenger = dispute?.challenger_pubkey ?? chainDispute?.challenger ?? null;
  const stake = dispute?.stake_lamports ?? chainDispute?.stake ?? null;
  const claimed = dispute?.claimed_output_hash ?? chainDispute?.claimed_output_hash ?? null;
  const status = dispute?.status ?? chainDispute?.status ?? "Open";
  const explanation = dispute?.ai_explanation ?? ai;

  const explain = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiPost<{ text: string }>("/ai/explain-dispute", { request_pda: pda });
      setAi(r.text);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-orange-200 bg-orange-50/50 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">Dispute</span>
        <Pill tone={/resolved|upheld|won|slash/i.test(status) ? "green" : /frivol|reject|lost/i.test(status) ? "red" : "amber"}>{status}</Pill>
      </div>
      <dl className="grid gap-2 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Challenger</dt>
          <dd><HashValue value={challenger} label="challenger" /></dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Stake</dt>
          <dd className="font-medium text-slate-800">{stake !== null ? `${lamportsToSol(stake)} SOL` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Claimed output hash</dt>
          <dd><HashValue value={claimed} label="claimed output hash" /></dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-4 text-xs">
        <ExtLink href={dispute?.open_explorer}>Open tx</ExtLink>
        <ExtLink href={dispute?.resolve_explorer}>Resolve tx</ExtLink>
      </div>
      {explanation ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-violet-700">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI explanation
          </p>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{explanation}</p>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={explain} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Explain this dispute
        </Button>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

export function DisputePanel({
  pda,
  status,
  receiptOutputHash,
  suggestedHash,
  dispute,
  chainDispute,
  challenge,
  onDone,
}: {
  pda: string;
  status: string | null;
  receiptOutputHash?: string | null;
  suggestedHash?: string | null;
  dispute: DisputeRow | null;
  chainDispute: ChainDispute | null;
  challenge: ChallengeInfo | null;
  onDone?: () => void;
}) {
  const { connected } = useWallet();
  const program = useVerityProgram();
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const remaining = useCountdown(challenge?.ends_at);

  // Prefill with the hash this browser computed when it disagrees with the receipt.
  useEffect(() => {
    if (suggestedHash && normHex(suggestedHash) !== normHex(receiptOutputHash)) setHash((h) => h || normHex(suggestedHash));
  }, [suggestedHash, receiptOutputHash]);

  const hasDispute = !!(dispute || chainDispute);
  const canOpen = status === "AwaitingVerification" && !hasDispute && remaining !== 0;
  if (!hasDispute && status !== "AwaitingVerification" && status !== "Disputed") return null;

  const clean = normHex(hash.trim());
  const valid = HEX64.test(clean);
  const sameAsReceipt = valid && clean === normHex(receiptOutputHash);

  const submit = async () => {
    if (!program || !valid || sameAsReceipt) return;
    setBusy(true);
    setError(null);
    try {
      const s = await openDispute(program, new PublicKey(pda), Array.from(fromHex(clean)));
      setSig(s);
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Challenge this result"
      icon={<Gavel className="h-4 w-4 text-orange-600" aria-hidden />}
      description="Anyone who re-executes and gets a different output can stake SOL to dispute the receipt during the challenge window. Honest challengers are rewarded from the provider's slashed stake."
      actions={
        remaining !== null ? (
          <Pill tone={remaining > 0 ? "amber" : "slate"}>
            <Timer className="h-3.5 w-3.5" aria-hidden />
            {remaining > 0 ? `Window closes in ${fmtDuration(remaining)}` : "Challenge window closed"}
          </Pill>
        ) : undefined
      }
    >
      {hasDispute && <ExistingDispute pda={pda} dispute={dispute} chainDispute={chainDispute} />}

      {canOpen && (
        <div className="space-y-3">
          {!connected || !program ? (
            <p className="text-sm text-amber-700">Connect your wallet (top right) to open a dispute.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="claimed-hash" className="text-sm font-semibold text-slate-700">
                  Claimed correct output hash
                </Label>
                <input
                  id="claimed-hash"
                  value={hash}
                  onChange={(e) => setHash(e.target.value)}
                  placeholder="64-char hex sha256 of the correct output"
                  spellCheck={false}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {hash && !valid && <p className="text-xs text-red-600">Must be a 32-byte hex hash.</p>}
                {sameAsReceipt && <p className="text-xs text-red-600">This equals the receipt&apos;s output hash — nothing to dispute.</p>}
                {suggestedHash && normHex(suggestedHash) !== normHex(receiptOutputHash) && (
                  <p className="text-xs text-slate-500">Prefilled from your in-browser re-execution, which disagrees with the receipt.</p>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Stake: {challenge?.min_dispute_stake != null ? `${lamportsToSol(challenge.min_dispute_stake)} SOL` : "the configured minimum"}{" "}
                (lost if the dispute is frivolous).
              </p>
              <Button
                onClick={submit}
                disabled={busy || !valid || sameAsReceipt}
                className="h-auto rounded-lg bg-orange-600 px-5 py-2.5 font-semibold text-white hover:bg-orange-700"
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {busy ? "Opening dispute…" : "Stake & open dispute"}
              </Button>
            </>
          )}
        </div>
      )}
      {status === "AwaitingVerification" && !hasDispute && remaining === 0 && (
        <p className="text-sm text-slate-500">The challenge window has closed; the result will finalize from verifier attestations.</p>
      )}
      {sig && (
        <p className="mt-3 text-sm text-emerald-700">
          Dispute opened. <ExtLink href={explorerTx(sig)}>View transaction</ExtLink>
        </p>
      )}
      {error && <p className="mt-3 break-words text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
