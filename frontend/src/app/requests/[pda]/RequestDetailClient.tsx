"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  FileCode,
  Layers,
  Award,
  Download,
  Sparkles,
  Loader2,
  Scale
} from "lucide-react";
import dynamic from "next/dynamic";

import { AppShell } from "@/components/ui/efferd-dashboard-2-utils/app-shell";
import { ChallengeWindowCountdown } from "@/components/requests/ChallengeWindowCountdown";
import { apiGet, apiPost, type RequestRow } from "@/lib/api";
import { explorerAddress } from "@/lib/env";
import { shortKey, lamportsToSol } from "@/lib/utils";

const DisputePanel = dynamic(
  () => import("@/components/disputes/DisputePanel").then((m) => m.DisputePanel),
  { ssr: false }
);

interface RequestDetail {
  pda: string;
  request?: RequestRow;
  row?: RequestRow;
  chain?: any;
  receipt?: any;
  chain_receipt?: any;
  attestations?: any[];
  dispute?: any;
  integrity?: {
    overall: string;
    program?: { status: string; actual?: string; expected?: string };
    input?: { status: string; actual?: string; expected?: string };
    output?: { status: string; actual?: string; expected?: string };
    receipt_signature?: { status: string; signer?: string };
  };
  timeline?: Array<{
    event_type: string;
    at: string;
    actor?: string;
    tx_sig?: string;
    payload?: any;
  }>;
}

export default function RequestDetailClient({ pda }: { pda: string }) {
  const [data, setData] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reverifying, setReverifying] = useState(false);
  const [reverifyResult, setReverifyResult] = useState<any | null>(null);

  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [explainingAi, setExplainingAi] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!pda) return;
    try {
      const res = await apiGet<RequestDetail>(`/requests/${pda}?integrity=true`);
      setData(res);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Failed to load request");
    } finally {
      setLoading(false);
    }
  }, [pda]);

  useEffect(() => {
    fetchDetail();
    const timer = setInterval(fetchDetail, 4000);
    return () => clearInterval(timer);
  }, [fetchDetail]);

  const handleReverify = async () => {
    setReverifying(true);
    try {
      const res = await apiPost<any>(`/requests/${pda}/reverify`);
      setReverifyResult(res);
      await fetchDetail();
    } catch (e: any) {
      setReverifyResult({ error: e.message || String(e), all_ok: false });
    } finally {
      setReverifying(false);
    }
  };

  const handleExplainAi = async () => {
    setExplainingAi(true);
    try {
      const res = await apiPost<{ text: string }>("/ai/explain-dispute", { request_pda: pda });
      setAiExplanation(res.text);
    } catch (e: any) {
      setAiExplanation(`AI dispute summary unavailable: ${e.message || String(e)}`);
    } finally {
      setExplainingAi(false);
    }
  };

  if (loading && !data) {
    return (
      <AppShell>
        <div className="container mx-auto py-16 max-w-5xl flex flex-col items-center justify-center min-h-[50vh] space-y-3">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-sm text-slate-500 font-mono">Loading request {shortKey(pda, 6)}…</p>
        </div>
      </AppShell>
    );
  }

  const req = data?.row || data?.request || data?.chain || ({} as any);
  const receipt = data?.receipt || data?.chain_receipt;
  const status = (req?.status || data?.chain?.status || "Unknown") as string;
  const dispute = data?.dispute;
  const attestations = data?.attestations || [];

  const bountySol = lamportsToSol(req?.bounty_lamports ?? data?.chain?.bounty);
  const receiptAtUnix = receipt?.submitted_at
    ? typeof receipt.submitted_at === "number"
      ? receipt.submitted_at
      : Math.floor(new Date(receipt.submitted_at).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const isAwaiting = status === "AwaitingVerification";
  const isDisputed = status === "Disputed";
  const isVerified = status === "Verified";
  const isRejected = status === "Rejected";

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const evidenceZipUrl = `${apiUrl}/requests/${pda}/evidence.zip`;

  return (
    <AppShell>
      <div className="container mx-auto py-8 px-4 sm:px-6 max-w-5xl space-y-6">
        {/* Navigation & Header Actions */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition shadow-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </Link>
            <div className="h-4 w-px bg-slate-300" />
            <span className="font-mono text-xs text-slate-500">
              PDA: <strong className="text-slate-900">{shortKey(pda, 8)}</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/verify/${pda}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition shadow-xs"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" /> Verify in Browser
            </Link>

            <a
              href={evidenceZipUrl}
              download={`verity-evidence-${pda}.zip`}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
              title="Download Evidence Bundle for Offline Audits"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" /> Evidence (.zip)
            </a>

            <a
              href={explorerAddress(pda) || `https://explorer.solana.com/address/${pda}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:text-blue-600 transition shadow-xs"
            >
              Explorer <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>

            <button
              onClick={handleReverify}
              disabled={reverifying}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reverifying ? "animate-spin" : ""}`} />
              {reverifying ? "Auditing…" : "Re-Verify"}
            </button>
          </div>
        </div>

        {/* Hero Card (Crisp White Theme) */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold text-slate-900">
                  {req?.title || "Verifiable Computation Job"}
                </h1>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold font-mono border ${
                    isVerified
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : isRejected
                      ? "bg-rose-50 text-rose-700 border-rose-200"
                      : isDisputed
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : isAwaiting
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-slate-100 text-slate-700 border-slate-200"
                  }`}
                >
                  {status}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono mt-1">
                Program Hash: {shortKey(req?.program_hash || data?.chain?.program_hash, 10)}
              </p>
            </div>

            <div className="text-right">
              <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Escrow Bounty</div>
              <div className="text-lg font-bold text-slate-900 font-mono">{bountySol} SOL</div>
            </div>
          </div>

          {/* Key Facts Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div>
              <span className="text-slate-400 block text-[11px] font-semibold uppercase">Requester:</span>
              <span className="text-slate-800 font-bold">{shortKey(req?.requester_pubkey || data?.chain?.requester, 6)}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px] font-semibold uppercase">Staked Provider:</span>
              <span className="text-slate-800 font-bold">{shortKey(receipt?.provider || req?.provider_pubkey, 6)}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px] font-semibold uppercase">Attestation Count:</span>
              <span className="text-slate-800 font-bold">{attestations.length} Node(s)</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px] font-semibold uppercase">Fuel Consumed:</span>
              <span className="text-slate-800 font-bold">{receipt?.fuel_used ? `${receipt.fuel_used.toLocaleString()} units` : "—"}</span>
            </div>
          </div>

          {/* Challenge Window Countdown */}
          {isAwaiting && (
            <div className="pt-2">
              <ChallengeWindowCountdown receiptAt={receiptAtUnix} windowSecs={120} onExpired={fetchDetail} />
            </div>
          )}

          {/* Dispute Banner with AI Explainer Trigger */}
          {isDisputed && dispute && (
            <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-900 text-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Active Staked Dispute on Chain (Status: {dispute.status})
                </div>
                <button
                  type="button"
                  onClick={handleExplainAi}
                  disabled={explainingAi}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white border border-amber-200 text-amber-900 hover:bg-amber-100 font-semibold transition shadow-xs text-xs"
                >
                  {explainingAi ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-violet-600" />}
                  Explain with AI
                </button>
              </div>
              <p>
                A challenger staked SOL to challenge this receipt with claimed hash:
                <code className="ml-1 bg-white px-1.5 py-0.5 rounded font-mono text-[11px] border border-amber-200">
                  {shortKey(dispute.claimed_output_hash, 12)}
                </code>
              </p>

              {(aiExplanation || dispute.ai_explanation) && (
                <div className="p-3.5 rounded-lg bg-white border border-slate-200 text-slate-800 font-sans space-y-1 mt-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-violet-700">
                    <Sparkles className="w-3.5 h-3.5" /> AI Dispute Summary
                  </div>
                  <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                    {aiExplanation || dispute.ai_explanation}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Re-verify Audit Result Banner (if triggered) */}
        {reverifyResult && (
          <div
            className={`rounded-2xl border p-5 text-xs space-y-3 font-mono shadow-xs ${
              reverifyResult.all_ok
                ? "bg-emerald-50/80 border-emerald-200 text-emerald-900"
                : "bg-rose-50/80 border-rose-200 text-rose-900"
            }`}
          >
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
              <span className="font-bold flex items-center gap-2">
                {reverifyResult.all_ok ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Independent Re-Verification Passed
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-rose-600" /> Independent Re-Verification Flagged Inconsistencies
                  </>
                )}
              </span>
              <span className="text-[11px] opacity-75 font-semibold">
                Zero-Trust Audit Result
              </span>
            </div>

            {reverifyResult.checks && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {reverifyResult.checks.map((chk: any, idx: number) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 capitalize">{chk.target}:</span>
                      <span className={chk.ok ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                        {chk.ok ? "MATCH ✓" : "MISMATCH ✗"}
                      </span>
                    </div>
                    {chk.expected_hash && (
                      <div className="text-[10px] text-slate-500 truncate mt-1">
                        Expected: {shortKey(chk.expected_hash, 6)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dispute Panel (Wired in whenever AwaitingVerification or user wants to contest) */}
        {isAwaiting && (
          <DisputePanel
            requestPda={pda}
            currentOutputHash={receipt?.output_hash}
            minDisputeStake={5_000_000}
            onDisputed={fetchDetail}
          />
        )}

        {/* Blobs & Artifacts Inspection */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600" /> Cryptographic Artifacts & Blobs
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-blue-600" /> Committed Input Blob
              </span>
              <div className="text-slate-600 break-all">
                Hash: {req?.input_hash || data?.chain?.input_hash}
              </div>
              {req?.input_uri && (
                <div className="text-blue-700 font-semibold truncate">
                  URI: {req.input_uri}
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-emerald-600" /> Output Receipt Blob
              </span>
              <div className="text-slate-600 break-all">
                Hash: {receipt?.output_hash || "Awaiting provider execution…"}
              </div>
              {receipt?.output_uri && (
                <div className="text-emerald-700 font-semibold truncate">
                  URI: {receipt.output_uri}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Verifier Attestations Consensus Table */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" /> Verifier Node Attestations
            </h2>
            <span className="text-xs font-mono text-slate-500">
              Consensus Threshold: <strong className="text-slate-900">2/3 Registered Nodes</strong>
            </span>
          </div>

          {attestations.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-2">
              No attestations submitted yet. Verifiers poll every 30 seconds to independently re-execute.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono text-left">
                <thead className="border-b border-slate-200 text-slate-400">
                  <tr>
                    <th className="py-2.5">Verifier Pubkey</th>
                    <th className="py-2.5">Attested Output Hash</th>
                    <th className="py-2.5">Verdict</th>
                    <th className="py-2.5">Quorum Counted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attestations.map((att: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50 transition">
                      <td className="py-2.5 font-semibold text-slate-900">
                        {shortKey(att.verifier_pubkey || att.verifier, 6)}
                      </td>
                      <td className="py-2.5 text-slate-600 font-mono">
                        {shortKey(att.output_hash, 8)}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            att.matches
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-rose-50 text-rose-700 border border-rose-200"
                          }`}
                        >
                          {att.matches ? "MATCH ✓" : "MISMATCH ✗"}
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-600">
                        {att.counted ? "Yes (Registered)" : "No"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
