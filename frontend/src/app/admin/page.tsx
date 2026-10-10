"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  AlertTriangle,
  Play,
  RefreshCw,
  CheckCircle,
  Database,
  ArrowLeft,
  Flame,
  Zap,
  Terminal,
  FileCode,
  Lock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Copy,
  Info
} from "lucide-react";

interface ChaosFlag {
  name: string;
  enabled: boolean;
  updated_at?: string;
}

interface ChaosMeta {
  label: string;
  desc: string;
  detection: string;
  onChainResult: string;
  severity: "critical" | "high" | "medium";
}

const CHAOS_DETAILS: Record<string, ChaosMeta> = {
  PROVIDER_TAMPER_OUTPUT: {
    label: "Malicious Provider (Tamper Output)",
    desc: "Provider inflates net pay or credit score (e.g. net_cents += 100,000) before signing and publishing the receipt.",
    detection: "Verifiers re-execute deterministic WASM binary; computed output hash mismatches receipt.",
    onChainResult: "Mismatch quorum (\u22652) \u2192 Dispute auto-opened \u2192 Provider slashed 0.1 SOL to challenger & verifiers.",
    severity: "critical",
  },
  PROVIDER_SWAP_PROGRAM: {
    label: "Swapped Rule Set / Program",
    desc: "Provider executes an unauthorized WASM binary instead of the agreed bytecode committed on-chain.",
    detection: "Hash of downloaded WASM bytecode \u2260 on-chain program_hash commitment.",
    onChainResult: "Provider or verifiers abort; request times out on-chain and refunds bounty to requester.",
    severity: "high",
  },
  STORAGE_TAMPER_INPUT: {
    label: "Tamper Input Storage Blob",
    desc: "Simulates an off-chain database or S3 bucket attacker modifying the input JSON blob after request creation.",
    detection: "SHA-256 hash of fetched input JSON \u2260 on-chain input_hash committed in create_request.",
    onChainResult: "Provider and verifiers abort; UI flags INPUT TAMPERED \u274c. On-chain state protected.",
    severity: "high",
  },
  STORAGE_TAMPER_OUTPUT: {
    label: "Tamper Output Storage Blob",
    desc: "Simulates an attacker corrupting the output JSON stored in Supabase storage after receipt submission.",
    detection: "SHA-256 hash of output blob \u2260 immutable on-chain output_hash in Receipt account.",
    onChainResult: "UI/CLI flags OUTPUT BLOB TAMPERED \u274c; on-chain settlement remains intact.",
    severity: "medium",
  },
  PROVIDER_BAD_SIG: {
    label: "Forged Receipt Signature",
    desc: "Provider signs the execution receipt with an unauthorized private keypair instead of registered provider key.",
    detection: "Ed25519 precompile instruction introspection validates signer pubkey matches registered provider.",
    onChainResult: "Solana transaction rejected on-chain; invalid receipt is never stored on devnet.",
    severity: "critical",
  },
  VERIFIER_LAZY: {
    label: "Lazy Verifier Node",
    desc: "Verifier Node #1 copies provider's output hash blindly without independent WASM re-execution.",
    detection: "Lazy verifier is outvoted by honest verifiers when provider tampers results.",
    onChainResult: "Lazy vote recorded on-chain; honest consensus (\u22652) slashes provider and penalizes bad attestations.",
    severity: "high",
  },
};

const DEFAULT_FLAGS: ChaosFlag[] = [
  { name: "PROVIDER_TAMPER_OUTPUT", enabled: false },
  { name: "PROVIDER_SWAP_PROGRAM", enabled: false },
  { name: "STORAGE_TAMPER_INPUT", enabled: false },
  { name: "STORAGE_TAMPER_OUTPUT", enabled: false },
  { name: "PROVIDER_BAD_SIG", enabled: false },
  { name: "VERIFIER_LAZY", enabled: false },
];

export default function AdminChaosPage() {
  const [flags, setFlags] = useState<ChaosFlag[]>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<string | null>(null);
  const [togglingFlag, setTogglingFlag] = useState<string | null>(null);

  // Storage tamper tool state
  const [tamperPda, setTamperPda] = useState("");
  const [tamperTarget, setTamperTarget] = useState<"input" | "output">("output");
  const [tamperLoading, setTamperLoading] = useState(false);
  const [tamperResult, setTamperResult] = useState<any | null>(null);
  const [tamperError, setTamperError] = useState<string | null>(null);

  // Pitch guide drawer
  const [showPitchGuide, setShowPitchGuide] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const normalizeFlags = useCallback((data: any): ChaosFlag[] => {
    if (Array.isArray(data)) return data;
    if (data?.items && Array.isArray(data.items)) return data.items;
    if (data?.flags && typeof data.flags === "object") {
      return Object.entries(data.flags).map(([name, enabled]) => ({
        name,
        enabled: Boolean(enabled),
      }));
    }
    return DEFAULT_FLAGS;
  }, []);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/chaos`);
      if (res.ok) {
        const data = await res.json();
        setFlags(normalizeFlags(data));
      }
    } catch (e) {
      console.error("Failed to fetch chaos flags:", e);
    } finally {
      setLoading(false);
    }
  }, [API_URL, normalizeFlags]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const toggleFlag = async (name: string, currentVal: boolean) => {
    setTogglingFlag(name);
    try {
      const res = await fetch(`${API_URL}/admin/chaos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag: name, enabled: !currentVal }),
      });
      if (res.ok) {
        const data = await res.json();
        setFlags(normalizeFlags(data));
      } else {
        // Fallback optimistic update if backend responds differently
        setFlags((prev) =>
          prev.map((f) => (f.name === name ? { ...f, enabled: !currentVal } : f))
        );
      }
    } catch (err) {
      console.error("Error toggling flag:", err);
      setFlags((prev) =>
        prev.map((f) => (f.name === name ? { ...f, enabled: !currentVal } : f))
      );
    } finally {
      setTogglingFlag(null);
    }
  };

  const resetAllFlags = async () => {
    setLoading(true);
    try {
      for (const flag of flags) {
        if (flag.enabled) {
          await fetch(`${API_URL}/admin/chaos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ flag: flag.name, enabled: false }),
          });
        }
      }
      await fetchFlags();
    } catch (err) {
      console.error("Error resetting flags:", err);
    } finally {
      setLoading(false);
    }
  };

  const triggerWorker = async (job: string) => {
    setActiveJob(job);
    setJobResult(null);
    try {
      const res = await fetch(`${API_URL}/admin/run/${job}`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setJobResult(`Dispatched ${job.toUpperCase()} successfully: ${JSON.stringify(data.result || data)}`);
      } else {
        const text = await res.text();
        setJobResult(`Error triggering ${job}: ${text}`);
      }
    } catch (err: any) {
      setJobResult(`Network error triggering ${job}: ${err?.message || err}`);
    } finally {
      setTimeout(() => setActiveJob(null), 1200);
    }
  };

  const handleTamperBlob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tamperPda.trim()) return;

    setTamperLoading(true);
    setTamperError(null);
    setTamperResult(null);

    try {
      const res = await fetch(`${API_URL}/admin/tamper`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_pda: tamperPda.trim(),
          target: tamperTarget,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Server returned ${res.status}`);
      }

      const data = await res.json();
      setTamperResult(data);
    } catch (err: any) {
      setTamperError(err.message || "Failed to tamper storage blob");
    } finally {
      setTamperLoading(false);
    }
  };

  const activeCount = flags.filter((f) => f.enabled).length;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-red-500 selection:text-white">
      {/* Top Banner / Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition px-2.5 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900/70"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </Link>
            <div className="h-4 w-px bg-slate-800" />
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 relative">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${activeCount > 0 ? "bg-red-400" : "bg-emerald-400"}`} />
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${activeCount > 0 ? "bg-red-500" : "bg-emerald-500"}`} />
              </span>
              <span className="text-xs font-mono tracking-wider uppercase text-slate-400">
                {activeCount > 0 ? `${activeCount} Byzantine Mode(s) Active` : "Honest State (Normal)"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowPitchGuide(!showPitchGuide)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-950/40 border border-blue-500/30 text-blue-300 hover:bg-blue-900/40 text-xs font-semibold transition"
            >
              <FileCode className="w-3.5 h-3.5" />
              {showPitchGuide ? "Hide Pitch Script" : "3-Min Live Pitch Script"}
            </button>
            {activeCount > 0 && (
              <button
                onClick={resetAllFlags}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-500/40 text-red-300 hover:bg-red-900/50 text-xs font-semibold transition"
              >
                <Flame className="w-3.5 h-3.5 text-red-400" /> Reset All to Honest
              </button>
            )}
            <button
              onClick={fetchFlags}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto py-8 px-4 sm:px-6 space-y-8">
        {/* Header Hero */}
        <div className="relative overflow-hidden rounded-2xl border border-red-900/40 bg-gradient-to-r from-red-950/40 via-slate-900/80 to-slate-900/40 p-6 md:p-8 backdrop-blur shadow-2xl">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <ShieldAlert className="w-64 h-64 text-red-500" />
          </div>
          <div className="relative z-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-red-500/30 bg-red-950/60 text-red-400 text-xs font-mono font-medium mb-3">
              <Zap className="w-3 h-3 text-red-400" /> Judge Demo Mode &bull; Solana Devnet
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white flex items-center gap-3">
              Adversarial Chaos & Slashing Control Panel
            </h1>
            <p className="mt-3 text-sm sm:text-base text-slate-400 leading-relaxed">
              Verity protects outsourced compute against rogue providers, lazy verifiers, and corrupted storage.
              Toggle Byzantine modes below to prove live on-chain detection, quorum dispute consensus, and automatic stake slashing on Solana.
            </p>
          </div>
        </div>

        {/* 3-Minute Live Demo Pitch Script Accordion */}
        {showPitchGuide && (
          <div className="rounded-2xl border border-blue-800/40 bg-blue-950/20 p-6 backdrop-blur space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-blue-900/50 pb-3">
              <div className="flex items-center gap-2 text-blue-400 font-bold text-base">
                <FileCode className="w-5 h-5" /> 3-Minute Live Pitch Demonstration Script (For Judges)
              </div>
              <span className="text-xs font-mono text-blue-300/80">Follow this step-by-step sequence</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs leading-relaxed">
              <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2">
                <div className="font-semibold text-blue-300 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-blue-950 border border-blue-800 font-mono">0:00 &ndash; 0:30</span>
                  The Hook & Architecture
                </div>
                <p className="text-slate-400">
                  <strong className="text-slate-200">&quot;In outsourced compute, you either blindly trust an off-chain API, or you waste resources re-computing everything on an expensive L1. Verity solves this on Solana: commit &rarr; execute &rarr; signed receipt &rarr; independent re-execution &rarr; dispute with slashing.&quot;</strong>
                </p>
                <div className="text-slate-500 italic">Action: Show the Landing Page live counters and architecture diagram.</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2">
                <div className="font-semibold text-blue-300 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-blue-950 border border-blue-800 font-mono">0:30 &ndash; 1:15</span>
                  Happy Path & Zero-Trust Browser Verification
                </div>
                <p className="text-slate-400">
                  <strong className="text-slate-200">&quot;Here is our Payroll computation. We submit the job on Solana Devnet with a 0.01 SOL bounty.&quot;</strong>
                </p>
                <div className="text-slate-500 italic">
                  Action: Open /requests/[pda]. Point to <strong>&quot;Run Local Verification in My Browser&quot;</strong>: client-side WASM matches on-chain hash bit-for-bit without server trust.
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2">
                <div className="font-semibold text-red-300 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-red-950 border border-red-800 font-mono">1:15 &ndash; 2:15</span>
                  The Adversarial Moment (Slashing Live on Devnet)
                </div>
                <p className="text-slate-400">
                  <strong className="text-slate-200">&quot;Now let&apos;s see what happens when a provider cheats.&quot;</strong>
                </p>
                <div className="text-slate-500 italic">
                  Action: Flip <strong>PROVIDER_TAMPER_OUTPUT</strong> ON. Submit job. Show verifiers reporting mismatch &rarr; dispute auto-opens &rarr; Provider slashed 0.1 SOL on Solana Explorer.
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2">
                <div className="font-semibold text-amber-300 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-amber-950 border border-amber-800 font-mono">2:15 &ndash; 3:00</span>
                  Off-Chain Storage Tamper & CLI Auditor
                </div>
                <p className="text-slate-400">
                  <strong className="text-slate-200">&quot;Even if an attacker gains root access to our S3 bucket and edits the output file, Solana cryptographic commitments detect corruption instantly.&quot;</strong>
                </p>
                <div className="text-slate-500 italic">
                  Action: Flip <strong>STORAGE_TAMPER_OUTPUT</strong> ON. Show <code>OUTPUT BLOB TAMPERED ❌</code>. Run offline CLI: <code>python backend/scripts/verity_cli.py verify &lt;PDA&gt;</code>.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 6 Chaos Flags Grid */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                Byzantine Attack Vectors (The 6 Chaos Modes)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Toggle attack flags to instruct workers to simulate malicious actions during their next scheduled run.
              </p>
            </div>
            <div className="text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
              Devnet Quorum: <span className="text-emerald-400 font-bold">2/3 Nodes</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {flags.map((flag) => {
              const meta = CHAOS_DETAILS[flag.name] || {
                label: flag.name,
                desc: "Custom test flag",
                detection: "Local hash check against on-chain state.",
                onChainResult: "Execution abort or consensus rejection.",
                severity: "high",
              };

              const isArmed = flag.enabled;
              const isToggling = togglingFlag === flag.name;

              return (
                <div
                  key={flag.name}
                  className={`relative flex flex-col justify-between p-5 rounded-xl border transition-all duration-200 ${
                    isArmed
                      ? "bg-red-950/25 border-red-500/60 shadow-lg shadow-red-500/10 ring-1 ring-red-500/30"
                      : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div>
                    {/* Header: Title + Toggle */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {isArmed ? (
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                            </span>
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-slate-600" />
                          )}
                          <h3 className="font-semibold text-base text-slate-100">
                            {meta.label}
                          </h3>
                        </div>
                        <p className="text-xs font-mono text-slate-500">
                          <code>{flag.name}</code>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleFlag(flag.name, flag.enabled)}
                        disabled={isToggling}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          isArmed ? "bg-red-600" : "bg-slate-700 hover:bg-slate-600"
                        } ${isToggling ? "opacity-60 cursor-wait" : ""}`}
                        aria-pressed={isArmed}
                        title={`Toggle ${flag.name}`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            isArmed ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-slate-300 mt-3 leading-relaxed">
                      {meta.desc}
                    </p>

                    {/* Deep Info Pill Breakdown */}
                    <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2 text-xs">
                      <div className="flex items-start gap-2">
                        <span className="text-slate-500 shrink-0 font-medium font-mono text-[11px] w-20">Detection:</span>
                        <span className="text-slate-400 leading-tight">{meta.detection}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-slate-500 shrink-0 font-medium font-mono text-[11px] w-20">On-Chain:</span>
                        <span className={isArmed ? "text-red-300 font-medium leading-tight" : "text-emerald-400 leading-tight"}>
                          {meta.onChainResult}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer Badge */}
                  <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-mono text-[11px]">
                      Severity: <span className="uppercase text-slate-400">{meta.severity}</span>
                    </span>
                    <span
                      className={`font-semibold font-mono text-[11px] px-2 py-0.5 rounded-full ${
                        isArmed
                          ? "bg-red-950/80 text-red-400 border border-red-500/40 animate-pulse"
                          : "bg-slate-800/80 text-emerald-400 border border-slate-700"
                      }`}
                    >
                      {isArmed ? "\u26a0 BYZANTINE ARMED" : "\u2713 HONEST"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section: Off-Chain Storage Tamper Simulator */}
        <section className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-amber-400" />
                Live Off-Chain Storage Tamper Sandbox
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Directly mutate an existing input or output JSON blob stored in Supabase Storage for a given Request PDA.
                Used in Step 2:15 of the pitch to prove off-chain data corruption is detected by on-chain SHA-256 commitments.
              </p>
            </div>
            <span className="text-xs font-mono text-amber-400 bg-amber-950/40 border border-amber-800 px-2.5 py-1 rounded-md">
              Targeted Mutation
            </span>
          </div>

          <form onSubmit={handleTamperBlob} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Request PDA Address
                </label>
                <input
                  type="text"
                  placeholder="e.g. 7XqW... or copy PDA from request timeline"
                  value={tamperPda}
                  onChange={(e) => setTamperPda(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Target Blob
                </label>
                <select
                  value={tamperTarget}
                  onChange={(e) => setTamperTarget(e.target.value as "input" | "output")}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="output">Output Blob (outputs/[pda].json)</option>
                  <option value="input">Input Blob (inputs/[hash].json)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={tamperLoading || !tamperPda.trim()}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-xs font-bold text-white transition flex items-center gap-2 shadow"
              >
                {tamperLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Corrupting Blob...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" /> Corrupt {tamperTarget.toUpperCase()} Blob Now
                  </>
                )}
              </button>
              <span className="text-xs text-slate-500">
                Alters numeric values in the JSON blob without corrupting syntax.
              </span>
            </div>
          </form>

          {tamperError && (
            <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-800/60 text-xs text-red-300 font-mono">
              Error: {tamperError}
            </div>
          )}

          {tamperResult && (
            <div className="p-4 rounded-xl bg-slate-950 border border-amber-900/40 space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between text-amber-400 font-bold border-b border-slate-800 pb-2">
                <span>\u26a0 Storage Blob Corrupted Successfully</span>
                <a
                  href={tamperResult.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
                >
                  View in Supabase <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-300">
                <div>
                  <span className="text-slate-500">Original Hash:</span>
                  <div className="truncate text-emerald-400 mt-0.5">{tamperResult.original_hash}</div>
                </div>
                <div>
                  <span className="text-slate-500">Tampered Hash:</span>
                  <div className="truncate text-red-400 mt-0.5">{tamperResult.tampered_hash}</div>
                </div>
              </div>
              <div className="text-slate-400">
                <span className="text-slate-500">Mutation Applied:</span> {JSON.stringify(tamperResult.change)}
              </div>
            </div>
          )}
        </section>

        {/* Section: Manual Worker Dispatcher & Status */}
        <section className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Play className="w-5 h-5 text-blue-400" /> Immediate Worker Dispatcher
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Force background autonomous workers to execute a tick right now instead of waiting for the cron schedule.
              </p>
            </div>
            <div className="text-xs font-mono text-slate-400">
              Provider &bull; Verifiers &bull; Finalizer &bull; Indexer
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {[
              { id: "provider", label: "Trigger Provider Node", desc: "Claims open jobs & submits signed receipts" },
              { id: "verifier", label: "Trigger Verifier Quorum", desc: "Re-executes WASM & posts attestations" },
              { id: "finalizer", label: "Trigger Finalizer Node", desc: "Opens disputes & executes stake slashing" },
              { id: "indexer", label: "Trigger Chain Indexer", desc: "Syncs on-chain PDAs to database" },
            ].map((worker) => (
              <button
                key={worker.id}
                onClick={() => triggerWorker(worker.id)}
                disabled={activeJob === worker.id}
                className="flex flex-col items-start px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/80 disabled:opacity-50 text-left transition group min-w-[200px]"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 group-hover:text-white">
                  <Play className={`w-3.5 h-3.5 text-blue-400 ${activeJob === worker.id ? "animate-spin" : ""}`} />
                  {activeJob === worker.id ? "Running Tick..." : worker.label}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">{worker.desc}</div>
              </button>
            ))}
          </div>

          {jobResult && (
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-blue-300">
              {jobResult}
            </div>
          )}
        </section>

        {/* Section: Offline Auditor CLI Verification */}
        <section className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Terminal className="w-5 h-5 text-emerald-400" /> Offline Auditor Verification Tool
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Zero-server audit CLI: reads Request, Receipt, and Attestations directly from Solana RPC, executes wasmtime locally, and checks Ed25519 signatures.
              </p>
            </div>
            <button
              onClick={() => copyToClipboard("python backend/scripts/verity_cli.py verify <REQUEST_PDA>")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedCli ? "Copied Command!" : "Copy Command"}
            </button>
          </div>

          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 font-mono text-xs text-slate-300 space-y-2 overflow-x-auto">
            <div className="text-slate-500"># Run from repository root in PowerShell or terminal:</div>
            <div className="text-emerald-400 font-semibold">
              python backend/scripts/verity_cli.py verify {tamperPda.trim() || "<REQUEST_PDA>"}
            </div>
            <div className="text-slate-500 pt-2 border-t border-slate-900">
              # Output passes if all SHA-256 hashes, Ed25519 signatures, wasmtime re-executions, and verifier quorums match on Solana.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
