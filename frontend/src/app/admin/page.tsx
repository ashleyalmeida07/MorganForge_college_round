"use client";

import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Play,
  RefreshCw,
  Database,
  Flame,
  Terminal,
  ExternalLink,
  Copy,
  Scale,
  Clock,
  Cpu,
  Activity,
  KeyRound,
  ArrowUpRight,
  Zap,
  CheckCircle2,
  Lock,
  Check,
  RotateCcw,
  ListChecks,
  XCircle,
} from "lucide-react";

import { AppShell } from "@/components/ui/efferd-dashboard-2-utils/app-shell";
import {
  ApiError,
  apiGet,
  apiPost,
  type AdminConfig,
  type Me,
  type DisputeRow,
  type SimulationDetail,
  type SuiteDetail,
} from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { shortKey, lamportsToSol } from "@/lib/utils";
import { env, explorerTx } from "@/lib/env";

// ------------------------------------------------------------------ types

interface ChaosFlag {
  name: string;
  enabled: boolean;
}

interface ChaosResponse {
  flags: Record<string, boolean>;
  available: string[];
  items: ChaosFlag[];
}

interface TamperResult {
  target: string;
  uri: string;
  original_hash: string;
  tampered_hash: string;
  committed_hash?: string;
  change?: unknown;
  by?: string;
  url?: string;
  request_pda?: string;
  error?: string;
}

interface ActivityRow {
  seq: number;
  event_type: string;
  request_pda?: string | null;
  actor?: string | null;
  created_at: string;
  explorer?: string | null;
  request_explorer?: string | null;
}

interface ChaosMeta {
  label: string;
  desc: string;
  detection: string;
  onChainResult: string;
  severity: "critical" | "high" | "medium";
}

// ------------------------------------------------------------------ static data

const CHAOS_ORDER = [
  "PROVIDER_TAMPER_OUTPUT",
  "PROVIDER_SWAP_PROGRAM",
  "STORAGE_TAMPER_INPUT",
  "STORAGE_TAMPER_OUTPUT",
  "PROVIDER_BAD_SIG",
  "VERIFIER_LAZY",
  "ZK_CORRUPT_PROOF",
];

const CHAOS_DETAILS: Record<string, ChaosMeta> = {
  PROVIDER_TAMPER_OUTPUT: {
    label: "Malicious Provider (Tamper Output)",
    desc: "Provider inflates net pay or outputs (e.g. net_cents += 100,000) before signing and submitting the receipt.",
    detection: "Independent verifiers re-execute the deterministic WASM binary; computed hash mismatches provider receipt.",
    onChainResult: "Mismatch quorum (≥2) opens a staked dispute → provider staked SOL slashed to challenger & verifiers.",
    severity: "critical",
  },
  PROVIDER_SWAP_PROGRAM: {
    label: "Swapped Rule Set / Program",
    desc: "Provider executes an unauthorized WASM binary instead of the agreed bytecode committed on-chain.",
    detection: "Hash of downloaded WASM bytecode ≠ on-chain program_hash commitment.",
    onChainResult: "Execution aborted; request times out on-chain and refunds bounty back to requester.",
    severity: "high",
  },
  STORAGE_TAMPER_INPUT: {
    label: "Tamper Input Storage Blob",
    desc: "Simulates an off-chain database or bucket attacker modifying the input JSON after request creation.",
    detection: "SHA-256 of fetched input JSON ≠ immutable on-chain input_hash committed in create_request.",
    onChainResult: "Provider & verifiers abort execution; UI flags INPUT TAMPERED ✗. On-chain state protected.",
    severity: "high",
  },
  STORAGE_TAMPER_OUTPUT: {
    label: "Tamper Output Storage Blob",
    desc: "Simulates an attacker corrupting the output JSON stored in Supabase storage after receipt submission.",
    detection: "SHA-256 of output blob ≠ immutable on-chain output_hash in Receipt account.",
    onChainResult: "UI/CLI auditor flags OUTPUT BLOB TAMPERED ✗; on-chain settlement remains intact.",
    severity: "medium",
  },
  PROVIDER_BAD_SIG: {
    label: "Forged Receipt Signature",
    desc: "Provider signs the execution receipt with an unauthorized keypair instead of the registered provider key.",
    detection: "Ed25519 precompile instruction introspection validates signer pubkey against registered provider account.",
    onChainResult: "Solana transaction rejected on-chain; invalid receipt is never accepted on devnet.",
    severity: "critical",
  },
  VERIFIER_LAZY: {
    label: "Lazy Verifier Collusion",
    desc: "Verifier Node #1 copies provider output hash blindly without independent WASM re-execution.",
    detection: "Lazy verifier is outvoted by honest quorum (2/3) when malicious provider attempts fraud.",
    onChainResult: "Lazy vote recorded on-chain; honest consensus slashes provider and penalizes bad attestations.",
    severity: "high",
  },
  ZK_CORRUPT_PROOF: {
    label: "Corrupted zk Proof",
    desc: "Any Groth16 payroll proof submitted while armed (by the lab or the request page's zk panel) has proof A negated before it is sent.",
    detection: "The verity_zk_verifier pairing check fails on-chain: the corrupted proof does not satisfy the verifying key.",
    onChainResult: "verify_payroll rejected with InvalidProof; no zk proof record is written for the request.",
    severity: "high",
  },
};

const SCENARIOS = [
  {
    id: "malicious-provider",
    label: "Malicious Provider (Output Fraud)",
    badge: "CRITICAL ATTACK",
    tone: "red" as const,
    desc: "Provider flips output bytes (+100k) → verifier quorum flags mismatch → staked dispute opened → provider slashed.",
    flags: { PROVIDER_TAMPER_OUTPUT: true },
    targetOutcome: "Rejected (Provider Slashed)",
  },
  {
    id: "swapped-program",
    label: "Swapped WASM Rule Set",
    badge: "WASM TAMPER",
    tone: "red" as const,
    desc: "Provider executes counterfeit WASM bytecode → hash mismatch check aborts execution → bounty refunded.",
    flags: { PROVIDER_SWAP_PROGRAM: true },
    targetOutcome: "Expired / Rejected (Aborted)",
  },
  {
    id: "bad-sig",
    label: "Forged Receipt Signature",
    badge: "CRYPTO FORGERY",
    tone: "red" as const,
    desc: "Provider signs with a rogue keypair → Solana Ed25519 precompile introspection rejects the transaction.",
    flags: { PROVIDER_BAD_SIG: true },
    targetOutcome: "On-Chain Sig Reject",
  },
  {
    id: "lazy-verifier",
    label: "Lazy Verifier Quorum Collusion",
    badge: "BYZANTINE NODE",
    tone: "amber" as const,
    desc: "Malicious provider + 1 lazy verifier copies hash → 2 honest verifiers outvote (2/3 quorum) → provider slashed.",
    flags: { PROVIDER_TAMPER_OUTPUT: true, VERIFIER_LAZY: true },
    targetOutcome: "Quorum Outvote & Slashed",
  },
  {
    id: "storage-output",
    label: "Corrupted Storage Blob (Output)",
    badge: "STORAGE MUTATION",
    tone: "amber" as const,
    desc: "Off-chain output JSON mutated in Supabase → re-hash against immutable on-chain receipt flags TAMPERED ✗.",
    flags: { STORAGE_TAMPER_OUTPUT: true },
    targetOutcome: "Zero-Trust Hash Mismatch",
  },
  {
    id: "storage-input",
    label: "Tampered Input Blob",
    badge: "STORAGE MUTATION",
    tone: "amber" as const,
    desc: "Committed input JSON overwritten in storage → provider & verifiers re-hash it against the chain and refuse to run.",
    flags: { STORAGE_TAMPER_INPUT: true },
    targetOutcome: "Expired (Execution Refused)",
  },
  {
    id: "frivolous-dispute",
    label: "Frivolous Dispute",
    badge: "GRIEFING",
    tone: "amber" as const,
    desc: "Honest result challenged with a made-up hash → verifier quorum backs the provider → challenger forfeits stake.",
    flags: {},
    targetOutcome: "Provider Wins Dispute → Verified",
  },
  {
    id: "zk-corrupt-proof",
    label: "Corrupted zk Proof",
    badge: "ZK FORGERY",
    tone: "red" as const,
    desc: "Attacker submits a corrupted Groth16 proof for an honest payroll result → on-chain pairing check rejects it.",
    flags: { ZK_CORRUPT_PROOF: true },
    targetOutcome: "verify_payroll Rejected (InvalidProof)",
  },
  {
    id: "honest",
    label: "Honest Baseline",
    badge: "HONEST CONSENSUS",
    tone: "emerald" as const,
    desc: "Provider executes accurately → verifier quorum matches → challenge window elapses → Verified on devnet.",
    flags: {},
    targetOutcome: "Verified (Bounty Paid)",
  },
];

// ------------------------------------------------------------------ helpers

function fmtSeconds(total: number | null | undefined) {
  if (total == null) return "—";
  const s = Math.max(0, Math.floor(total));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

function Countdown({ endsAt, className }: { endsAt: string | null | undefined; className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!endsAt) return <span className={className}>—</span>;
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return <span className={className}>—</span>;
  const remaining = Math.max(0, Math.floor((end - now) / 1000));
  if (remaining <= 0) return <span className={className}>Window Closed</span>;
  return <span className={className}>{fmtSeconds(remaining)}</span>;
}

// ------------------------------------------------------------------ page component

export default function AdminPage() {
  const me = useApi<Me>("/me");

  if (me.data?.is_admin) return <AdminChaosPage />;

  const denied = me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403);
  return (
    <AppShell>
      <div className="w-full max-w-xl mx-auto py-20 px-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Lock className="w-8 h-8 mx-auto text-slate-400" />
          {me.loading && !me.data && !me.error ? (
            <p className="mt-4 text-sm text-slate-500">Checking admin access…</p>
          ) : me.error && !denied ? (
            <>
              <h1 className="mt-4 text-lg font-bold text-slate-900">Couldn&apos;t reach the backend</h1>
              <p className="mt-2 text-sm text-slate-500">{me.error.message}</p>
              <button
                onClick={me.reload}
                className="mt-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </>
          ) : (
            <>
              <h1 className="mt-4 text-lg font-bold text-slate-900">Admin access required</h1>
              <p className="mt-2 text-sm text-slate-500">
                The simulation lab can flip chaos flags and tamper with stored blobs, so it is limited to accounts listed in the
                backend&apos;s <code className="font-mono">ADMIN_EMAILS</code> or with the admin role.
              </p>
              <Link href="/dashboard" className="mt-5 inline-block text-sm font-semibold text-blue-600 hover:underline">
                Back to dashboard
              </Link>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function AdminChaosPage() {
  const [togglingFlag, setTogglingFlag] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapSummary, setBootstrapSummary] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Full Interactive Simulation State
  const [simulating, setSimulating] = useState(false);
  const [activeSimId, setActiveSimId] = useState<string | null>(null);
  const [activeSim, setActiveSim] = useState<SimulationDetail | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<string>("malicious-provider");
  const [terminalFilter, setTerminalFilter] = useState<"all" | "chain" | "warn" | "exec">("all");
  const [suite, setSuite] = useState<SuiteDetail | null>(null);
  const suiteRunning = suite?.status === "running";
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Storage tamper sandbox
  const [tamperPda, setTamperPda] = useState("");
  const [tamperTarget, setTamperTarget] = useState<"input" | "output">("output");
  const [tamperLoading, setTamperLoading] = useState(false);
  const [tamperResult, setTamperResult] = useState<TamperResult | null>(null);
  const [tamperError, setTamperError] = useState<string | null>(null);

  const chaos = useApi<ChaosResponse>("/admin/chaos", 4000, [{ table: "chaos_flags" }]);
  const config = useApi<AdminConfig>("/admin/config", 8000);
  const disputes = useApi<DisputeRow[]>("/disputes", 4000, [{ table: "disputes" }]);
  const activity = useApi<ActivityRow[]>("/activity?limit=14", 5000, [{ table: "audit_log" }]);

  const flags = useMemo<ChaosFlag[]>(() => {
    const raw = chaos.data;
    if (!raw) return CHAOS_ORDER.map((name) => ({ name, enabled: false }));
    if (Array.isArray(raw.items) && raw.items.length) {
      return [...raw.items].sort((a, b) => CHAOS_ORDER.indexOf(a.name) - CHAOS_ORDER.indexOf(b.name));
    }
    return CHAOS_ORDER.map((name) => ({ name, enabled: Boolean(raw.flags?.[name]) }));
  }, [chaos.data]);

  const activeCount = flags.filter((f) => f.enabled).length;
  const cfg = config.data?.config ?? null;
  const disputeRows = disputes.data ?? [];
  const openDisputes = disputeRows.filter((d) => d.status === "Open");

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
  }, []);

  const refreshAll = useCallback(() => {
    chaos.reload();
    config.reload();
    disputes.reload();
    activity.reload();
  }, [chaos, config, disputes, activity]);

  // Simulation Runner
  const runFullSimulation = useCallback(
    async (scenarioId: string) => {
      setSelectedScenario(scenarioId);
      setSimulating(true);
      setActiveSim(null);
      setActiveSimId(null);
      try {
        const init = await apiPost<SimulationDetail>("/admin/simulate", {
          scenario: scenarioId,
          fast: true,
          bounty: 10_000_000,
        });
        setActiveSimId(init.id);
        setActiveSim(init);
        // Pre-fill tamper input with simulated PDA if available
        if (init.result?.pda) setTamperPda(init.result.pda);
      } catch (err) {
        setJobResult(`Failed to launch simulation: ${err instanceof Error ? err.message : String(err)}`);
        setSimulating(false);
      }
    },
    [],
  );

  // Poll active simulation updates
  const simStatus = activeSim?.status;
  useEffect(() => {
    if (!activeSimId || simStatus !== "running") return;
    const timer = setInterval(async () => {
      try {
        const updated = await apiGet<SimulationDetail>(`/admin/simulate/${activeSimId}`);
        setActiveSim(updated);
        if (updated.result?.pda && !tamperPda) setTamperPda(updated.result.pda);
        if (updated.status !== "running" && !suiteRunning) {
          setSimulating(false);
          refreshAll();
        }
      } catch {
        // ignore transient poll error
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [activeSimId, simStatus, refreshAll, tamperPda, suiteRunning]);

  // Run every scenario back to back (server-side, so it survives navigation).
  const runAllScenarios = useCallback(async () => {
    setJobResult(null);
    try {
      const started = await apiPost<SuiteDetail>("/admin/simulate-all", { fast: true, bounty: 10_000_000 });
      setSuite(started);
      setSimulating(true);
    } catch (err) {
      setJobResult(`Failed to start the suite: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // Resume showing a suite that is still running (e.g. after a page reload).
  useEffect(() => {
    apiGet<{ suites: SuiteDetail[] }>("/admin/suites?limit=1")
      .then((r) => {
        const latest = r.suites?.[0];
        if (latest) setSuite(latest);
        if (latest?.status === "running") setSimulating(true);
      })
      .catch(() => {});
  }, []);

  // Poll the suite; stream whichever scenario is running into the terminal.
  const suiteId = suite?.id;
  useEffect(() => {
    if (!suiteId || !suiteRunning) return;
    const timer = setInterval(async () => {
      try {
        const s = await apiGet<SuiteDetail>(`/admin/suites/${suiteId}`);
        setSuite(s);
        const run = s.runs.find((r) => r.status === "running");
        if (run?.sim_id && run.sim_id !== activeSimId) {
          setSelectedScenario(run.scenario);
          setActiveSimId(run.sim_id);
          setActiveSim(await apiGet<SimulationDetail>(`/admin/simulate/${run.sim_id}`));
        }
        if (s.status !== "running") {
          setSimulating(false);
          refreshAll();
        }
      } catch {
        // ignore transient poll error
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [suiteId, suiteRunning, activeSimId, refreshAll]);

  // Auto-scroll terminal
  useEffect(() => {
    if (simulating) {
      terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeSim?.steps?.length, simulating]);

  const toggleFlag = useCallback(
    async (name: string, currentVal: boolean) => {
      setTogglingFlag(name);
      try {
        await apiPost<ChaosResponse>("/admin/chaos", { flag: name, enabled: !currentVal });
      } catch (err) {
        setJobResult(`Failed to toggle ${name}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setTogglingFlag(null);
        chaos.reload();
        config.reload();
      }
    },
    [chaos, config],
  );

  const resetAllFlags = useCallback(async () => {
    try {
      for (const flag of flags) {
        if (flag.enabled) {
          await apiPost<ChaosResponse>("/admin/chaos", { flag: flag.name, enabled: false });
        }
      }
    } catch (err) {
      setJobResult(`Reset failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      refreshAll();
    }
  }, [flags, refreshAll]);

  const triggerWorker = useCallback(async (job: string) => {
    setActiveJob(job);
    setJobResult(null);
    try {
      const data = await apiPost<{ result?: unknown }>(`/admin/run/${job}`);
      setJobResult(`${job.toUpperCase()} tick executed: ${JSON.stringify(data.result ?? data)}`);
    } catch (err) {
      setJobResult(`Error triggering ${job}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTimeout(() => setActiveJob(null), 1200);
    }
  }, []);

  const handleBootstrap = useCallback(async () => {
    setBootstrapping(true);
    setBootstrapSummary(null);
    try {
      const data = await apiPost<{ ok?: boolean; steps?: unknown[]; error?: string }>("/admin/bootstrap", {
        airdrop: true,
      });
      if (data.ok) {
        setBootstrapSummary("Solana devnet cluster bootstrap verified: Config, Staked Provider, and Verifiers are active.");
      } else {
        setBootstrapSummary(`Bootstrap warning: ${JSON.stringify(data.steps ?? data)}`);
      }
    } catch (err) {
      setBootstrapSummary(`Bootstrap error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBootstrapping(false);
      refreshAll();
    }
  }, [refreshAll]);

  const handleTamperBlob = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!tamperPda.trim()) return;
      setTamperLoading(true);
      setTamperError(null);
      setTamperResult(null);
      try {
        const data = await apiPost<TamperResult>("/admin/tamper", {
          request_pda: tamperPda.trim(),
          target: tamperTarget,
        });
        setTamperResult(data);
      } catch (err) {
        setTamperError(err instanceof Error ? err.message : "Failed to tamper storage blob");
      } finally {
        setTamperLoading(false);
      }
    },
    [tamperPda, tamperTarget],
  );

  // Compute pipeline stage for visual feedback
  const pipelineState = useMemo(() => {
    if (!activeSim) return { stage: 0, label: "Idle / Ready" };
    const steps = activeSim.steps || [];
    const isDone = activeSim.status !== "running";

    if (isDone) {
      return { stage: 5, label: "Simulation Completed" };
    }
    if (steps.some((s) => s.phase === "settle" || s.phase === "dispute")) {
      return { stage: 4, label: "On-Chain Dispute & Slashing" };
    }
    if (steps.some((s) => s.phase === "verify" || s.msg.includes("verifier"))) {
      return { stage: 3, label: "Verifier Quorum Re-execution" };
    }
    if (steps.some((s) => s.phase === "execute" || s.msg.includes("provider"))) {
      return { stage: 2, label: "Provider WASM Execution" };
    }
    if (steps.some((s) => s.phase === "create" || s.phase === "prepare")) {
      return { stage: 1, label: "Requester Commitment Broadcast" };
    }
    return { stage: 1, label: "Setting Up Sandbox Environment" };
  }, [activeSim]);

  const simSteps = activeSim?.steps;
  const filteredSteps = useMemo(() => {
    if (!simSteps) return [];
    if (terminalFilter === "all") return simSteps;
    if (terminalFilter === "chain") return simSteps.filter((s) => s.level === "chain" || s.tx);
    if (terminalFilter === "warn") return simSteps.filter((s) => s.level === "warn" || s.level === "error");
    if (terminalFilter === "exec") return simSteps.filter((s) => s.level === "exec" || s.level === "ok");
    return simSteps;
  }, [simSteps, terminalFilter]);

  const statCards = [
    {
      title: "Active Chaos Vectors",
      value: activeCount > 0 ? `${activeCount} Armed` : "0 (Honest)",
      sub: activeCount > 0 ? "Byzantine mode engaged" : "100% Honest Consensus",
      icon: ShieldAlert,
      tone: activeCount > 0 ? "text-rose-600 bg-rose-50 border-rose-200" : "text-emerald-600 bg-emerald-50 border-emerald-200",
    },
    {
      title: "Staked Disputes",
      value: String(openDisputes.length),
      sub: `${disputeRows.length} total dispute cases logged`,
      icon: Scale,
      tone: openDisputes.length > 0 ? "text-amber-600 bg-amber-50 border-amber-200" : "text-blue-600 bg-blue-50 border-blue-200",
    },
    {
      title: "Consensus Quorum",
      value: cfg ? `${cfg.required_attestations} of ${cfg.verifier_count}` : "2 of 3",
      sub: "BFT Honest Attestations Required",
      icon: ShieldCheck,
      tone: "text-blue-600 bg-blue-50 border-blue-200",
    },
    {
      title: "Challenge Window",
      value: cfg ? fmtSeconds(cfg.challenge_window_secs) : "120s",
      sub: cfg ? `Stake: ${lamportsToSol(cfg.min_dispute_stake).toFixed(2)} SOL` : "On-chain Clock timing",
      icon: Clock,
      tone: "text-purple-600 bg-purple-50 border-purple-200",
    },
  ];

  return (
    <AppShell>
      <div className="space-y-8 w-full max-w-[1280px] mx-auto pb-16 px-2 sm:px-4">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6 pt-2">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600" />
              </span>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
                Fraud & Byzantine Simulation Lab
              </h1>
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-slate-900 text-white">
                Admin Defense Center
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
              Stage cryptographic fraud attacks against the Verity Solana core, simulate rogue providers and lazy verifiers,
              and watch autonomous on-chain slashing and zero-trust consensus in real-time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleBootstrap}
              disabled={bootstrapping}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition shadow-xs disabled:opacity-50"
            >
              <Database className={`w-3.5 h-3.5 ${bootstrapping ? "animate-spin text-blue-600" : "text-slate-500"}`} />
              {bootstrapping ? "Bootstrapping..." : "Bootstrap Devnet"}
            </button>
            <button
              onClick={resetAllFlags}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 transition shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
              Reset All to Honest
            </button>
            <button
              onClick={refreshAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              Refresh
            </button>
          </div>
        </div>

        {bootstrapSummary && (
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 font-mono flex items-center justify-between">
            <span>{bootstrapSummary}</span>
            <button onClick={() => setBootstrapSummary(null)} className="text-blue-500 hover:text-blue-700 font-bold ml-2">
              Dismiss
            </button>
          </div>
        )}

        {/* High-level Stat Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{card.title}</span>
                  <div className={`w-8 h-8 rounded-xl border flex items-center justify-center ${card.tone}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-2xl font-bold tracking-tight text-slate-900 font-mono">{card.value}</div>
                  <div className="text-[11px] text-slate-500 mt-1">{card.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* =========================================================================
            SECTION 1: INTERACTIVE ATTACK SIMULATION THEATER (WOW FACTOR)
            ========================================================================= */}
        <section className="rounded-3xl border border-slate-800 bg-slate-950 text-white p-6 sm:p-8 shadow-xl relative overflow-hidden space-y-6">
          <div className="absolute top-0 right-0 w-96 h-96 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

          {/* Theater Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-red-500" />
                <h2 className="text-lg font-bold text-white tracking-wide">
                  Live Adversarial Simulation Theater
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-950 text-red-400 border border-red-800">
                  REAL SOLANA DEVNET EXECUTION
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Launch end-to-end attacks on devnet: see transaction creation, output tampering, verifier disagreement, and slashing in real-time.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">
                Status: <strong className={simulating ? "text-amber-400" : "text-emerald-400"}>
                  {simulating ? "● RUNNING SIMULATION" : activeSim ? "✓ COMPLETED" : "IDLE"}
                </strong>
              </span>
            </div>
          </div>

          {/* Visual Interactive Execution Pipeline */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                Current Stage: <span className="text-white font-semibold">{pipelineState.label}</span>
              </span>
              <span>Stage {pipelineState.stage} / 5</span>
            </div>

            {/* Pipeline Step Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              {[
                { step: 1, label: "1. Requester", sub: "Input & Bounty Commitment", icon: Lock },
                { step: 2, label: "2. Provider", sub: "Execution / Tampering", icon: Zap },
                { step: 3, label: "3. WASM Core", sub: "Wasmtime Sandbox", icon: Cpu },
                { step: 4, label: "4. Verifier Quorum", sub: "3 Node Consensus Check", icon: ShieldCheck },
                { step: 5, label: "5. Settlement", sub: "Devnet Slashing / Payout", icon: Scale },
              ].map((stageItem) => {
                const Icon = stageItem.icon;
                const isActive = pipelineState.stage === stageItem.step;
                const isPassed = pipelineState.stage > stageItem.step;
                return (
                  <div
                    key={stageItem.step}
                    className={`rounded-2xl p-3.5 border transition-all duration-300 flex flex-col justify-between ${
                      isActive
                        ? "bg-blue-950/60 border-blue-500 ring-2 ring-blue-500/30"
                        : isPassed
                        ? "bg-slate-900/80 border-emerald-500/50 text-slate-300"
                        : "bg-slate-900/40 border-slate-800/80 text-slate-500"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold font-mono">
                        {stageItem.label}
                      </span>
                      {isPassed ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : isActive ? (
                        <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                      ) : (
                        <Icon className="w-3.5 h-3.5 opacity-40" />
                      )}
                    </div>
                    <div className="text-[10px] mt-2 opacity-75 font-mono truncate">{stageItem.sub}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Scenario Selector Chips */}
          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Choose Attack Vector To Simulate:
              </div>
              <button
                onClick={runAllScenarios}
                disabled={simulating}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/60 bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg shadow-red-900/40 transition hover:bg-red-500 disabled:opacity-50"
              >
                <ListChecks className="h-3.5 w-3.5" />
                {suiteRunning ? `Running ${Math.min((suite?.completed ?? 0) + 1, suite?.total ?? 1)}/${suite?.total ?? 1}…` : "Run All Scenarios"}
              </button>
            </div>

            {suite && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <span className="text-slate-300">
                    Adversarial suite <span className="text-slate-500">#{suite.id}</span> ·{" "}
                    {suite.status === "running" ? (
                      <span className="text-amber-400">running {suite.completed}/{suite.total}</span>
                    ) : (
                      <span className={suite.failed ? "text-red-400" : "text-emerald-400"}>
                        {suite.passed}/{suite.total} passed
                      </span>
                    )}
                  </span>
                  <span className="text-slate-500">{Math.round(suite.elapsed_s)}s elapsed</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full transition-all ${suite.failed ? "bg-red-500" : "bg-emerald-500"}`}
                    style={{ width: `${suite.total ? (100 * suite.completed) / suite.total : 0}%` }}
                  />
                </div>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {suite.runs.map((r) => (
                    <li
                      key={r.scenario}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-[11px] font-mono"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-slate-200">
                        {r.status === "running" ? (
                          <RefreshCw className="h-3 w-3 shrink-0 animate-spin text-blue-400" />
                        ) : r.status === "pending" ? (
                          <Clock className="h-3 w-3 shrink-0 text-slate-500" />
                        ) : r.passed ? (
                          <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                        ) : (
                          <XCircle className="h-3 w-3 shrink-0 text-red-400" />
                        )}
                        <span className="truncate">{r.label}</span>
                      </span>
                      <span className="shrink-0 text-slate-500">
                        {r.status === "pending"
                          ? "queued"
                          : r.status === "running"
                          ? "running"
                          : r.error
                          ? "error"
                          : `${r.final_status ?? "?"}${r.detected ? " · detected" : ""}`}
                        {r.request_pda && (
                          <Link href={`/requests/${r.request_pda}`} className="ml-2 text-blue-400 hover:underline">
                            open
                          </Link>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {SCENARIOS.map((sc) => {
                const isSelected = selectedScenario === sc.id;
                return (
                  <button
                    key={sc.id}
                    onClick={() => runFullSimulation(sc.id)}
                    disabled={simulating}
                    className={`text-left p-3.5 rounded-2xl border transition-all duration-200 flex flex-col justify-between group ${
                      isSelected
                        ? "bg-slate-900 border-red-500 ring-1 ring-red-500/40"
                        : "bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
                    } disabled:opacity-50`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-white group-hover:text-red-400 transition">
                          {sc.label}
                        </span>
                        <span
                          className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase border ${
                            sc.tone === "red"
                              ? "bg-red-950 text-red-400 border-red-800"
                              : sc.tone === "amber"
                              ? "bg-amber-950 text-amber-400 border-amber-800"
                              : "bg-emerald-950 text-emerald-400 border-emerald-800"
                          }`}
                        >
                          {sc.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                        {sc.desc}
                      </p>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-slate-500">Expected: {sc.targetOutcome}</span>
                      <span className="text-blue-400 font-semibold group-hover:translate-x-0.5 transition flex items-center gap-0.5">
                        <Play className="w-2.5 h-2.5" /> Run Attack
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Simulation Stream & Live Terminal */}
          {activeSim && (
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span className="font-mono text-xs font-bold text-white">
                    Simulation Feed ({activeSim.label}) — {activeSim.steps?.length || 0} Events
                  </span>
                  {activeSim.result?.pda && (
                    <span className="text-xs font-mono text-slate-400 ml-2">
                      PDA:{" "}
                      <Link
                        href={`/requests/${activeSim.result.pda}`}
                        className="text-blue-400 underline hover:text-blue-300 font-bold"
                      >
                        {shortKey(activeSim.result.pda, 6)}
                      </Link>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-[11px] font-mono">
                  {(["all", "chain", "warn", "exec"] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setTerminalFilter(filter)}
                      className={`px-2.5 py-1 rounded-lg uppercase text-[10px] font-bold transition ${
                        terminalFilter === filter
                          ? "bg-slate-800 text-white border border-slate-700"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                  <button
                    onClick={() =>
                      copyToClipboard(
                        activeSim.steps.map((s) => `[+${s.t}s] [${s.phase.toUpperCase()}] ${s.msg}`).join("\n"),
                        "terminal",
                      )
                    }
                    className="ml-2 text-slate-400 hover:text-white px-2 py-1 rounded border border-slate-800"
                  >
                    {copied === "terminal" ? "Copied ✓" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Terminal Display */}
              <div className="rounded-2xl bg-black border border-slate-800 p-4 font-mono text-xs max-h-80 overflow-y-auto space-y-2 scrollbar-thin">
                {filteredSteps.map((step) => {
                  const isChain = step.level === "chain";
                  const isWarn = step.level === "warn" || step.level === "error";
                  const isOk = step.level === "ok";
                  return (
                    <div key={step.seq} className="flex items-start gap-2.5 leading-relaxed">
                      <span className="text-slate-600 shrink-0 select-none">
                        +{step.t.toFixed(1)}s
                      </span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${
                          isChain
                            ? "bg-blue-950 text-blue-400 border border-blue-800"
                            : isWarn
                            ? "bg-rose-950 text-rose-400 border border-rose-800"
                            : isOk
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                            : "bg-slate-900 text-slate-400 border border-slate-800"
                        }`}
                      >
                        {step.phase}
                      </span>
                      <span
                        className={`break-words ${
                          isWarn
                            ? "text-rose-300 font-semibold"
                            : isOk
                            ? "text-emerald-300 font-semibold"
                            : isChain
                            ? "text-blue-200"
                            : "text-slate-300"
                        }`}
                      >
                        {step.msg}
                      </span>
                      {step.tx && (
                        <a
                          href={explorerTx(step.tx) || `https://explorer.solana.com/tx/${step.tx}?cluster=devnet`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-blue-400 underline hover:text-blue-300 shrink-0 inline-flex items-center gap-0.5 ml-auto"
                        >
                          tx: {shortKey(step.tx, 4)} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  );
                })}
                <div ref={terminalEndRef} />
              </div>

              {/* Simulation Result Banner */}
              {activeSim.status !== "running" && (
                <div
                  className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4 font-mono text-xs ${
                    activeSim.result?.detected
                      ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-300"
                      : activeSim.scenario === "honest"
                      ? "bg-blue-950/40 border-blue-500/50 text-blue-300"
                      : "bg-amber-950/40 border-amber-500/50 text-amber-300"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {activeSim.result?.detected ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    ) : (
                      <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0" />
                    )}
                    <div>
                      <div className="font-bold text-sm text-white">
                        {activeSim.result?.detected
                          ? "ATTACK CAUGHT & DEFENDED ON SOLANA DEVNET"
                          : `SCENARIO FINALIZED: ${activeSim.result?.status || "Verified"}`}
                      </div>
                      <div className="text-[11px] opacity-80 mt-0.5">
                        Execution elapsed: {activeSim.elapsed_s}s · Status: {activeSim.result?.status || "Resolved"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {activeSim.result?.pda && (
                      <Link
                        href={`/requests/${activeSim.result.pda}`}
                        className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition flex items-center gap-1.5 shadow-xs"
                      >
                        Inspect Request Integrity <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* =========================================================================
            SECTION 2: BYZANTINE CHAOS SWITCHBOARD
            ========================================================================= */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" /> Byzantine Attack Vector Switchboard
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Toggle individual chaos flags to instruct autonomous provider and verifier daemons to behave maliciously on scheduled ticks.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-600 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
              Active Flags: <strong className={activeCount > 0 ? "text-red-600" : "text-emerald-600"}>{activeCount} of {flags.length}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {flags.map((flag) => {
              const meta = CHAOS_DETAILS[flag.name] ?? {
                label: flag.name,
                desc: "Autonomous attack vector.",
                detection: "Local hash check against on-chain state.",
                onChainResult: "Execution abort or consensus rejection.",
                severity: "high" as const,
              };
              const armed = flag.enabled;
              const toggling = togglingFlag === flag.name;
              return (
                <div
                  key={flag.name}
                  className={`flex flex-col justify-between p-5 rounded-2xl border transition-all duration-200 ${
                    armed
                      ? "bg-red-50/70 border-red-300 ring-1 ring-red-200 shadow-xs"
                      : "bg-white border-slate-200/90 hover:border-slate-300"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${armed ? "bg-red-500 animate-pulse" : "bg-slate-300"}`} />
                          <h3 className="font-bold text-sm text-slate-900">{meta.label}</h3>
                        </div>
                        <code className="text-[11px] font-mono text-slate-400">{flag.name}</code>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={armed}
                        aria-label={`Toggle ${flag.name}`}
                        onClick={() => toggleFlag(flag.name, flag.enabled)}
                        disabled={toggling}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-red-500/40 ${
                          armed ? "bg-red-600" : "bg-slate-300 hover:bg-slate-400"
                        } ${toggling ? "opacity-60 cursor-wait" : ""}`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                            armed ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>

                    <p className="text-xs text-slate-600 mt-3 leading-relaxed">{meta.desc}</p>

                    <div className="mt-4 pt-3 border-t border-slate-200/70 space-y-2 text-xs">
                      <div className="flex items-start gap-2">
                        <span className="text-slate-400 shrink-0 w-20 font-medium">Detection:</span>
                        <span className="text-slate-700 leading-tight">{meta.detection}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-slate-400 shrink-0 w-20 font-medium">On-chain:</span>
                        <span className={`${armed ? "text-red-600 font-semibold" : "text-slate-700"} leading-tight`}>
                          {meta.onChainResult}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200/70 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400">
                      Severity: <span className="uppercase text-slate-600 font-bold">{meta.severity}</span>
                    </span>
                    <span
                      className={`font-semibold text-[11px] px-2.5 py-0.5 rounded-full border ${
                        armed
                          ? "bg-red-100 text-red-700 border-red-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      }`}
                    >
                      {armed ? "BYZANTINE ARMED" : "HONEST ACTIVE"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* =========================================================================
            SECTION 3: DISPUTE RESOLUTION QUORUM MONITOR
            ========================================================================= */}
        <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Scale className="w-4 h-4 text-amber-600" /> Staked Dispute Resolution Quorum Monitor
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Quorum threshold of counted verifier attestations (≥2 of 3) confirms Challenger&apos;s claimed hash → Malicious Provider slashed.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
              <Activity className="w-3.5 h-3.5" /> Live Consensus
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="border-b border-slate-100 text-slate-400 font-mono">
                <tr>
                  <th className="py-2.5 font-medium">Request PDA</th>
                  <th className="py-2.5 font-medium">Rule Set</th>
                  <th className="py-2.5 font-medium">Dispute Status</th>
                  <th className="py-2.5 font-medium">Claimed Output Hash</th>
                  <th className="py-2.5 font-medium">Verifier Support</th>
                  <th className="py-2.5 font-medium">Challenge Window</th>
                  <th className="py-2.5 font-medium text-right">On-Chain Links</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {disputeRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 italic">
                      {disputes.loading ? "Loading dispute records..." : "No disputes recorded yet. Run a Malicious Provider simulation above to trigger one!"}
                    </td>
                  </tr>
                ) : (
                  disputeRows.map((d) => {
                    const required = d.required_attestations ?? cfg?.required_attestations ?? 2;
                    const won = d.status === "ChallengerWon";
                    const lost = d.status === "ProviderWon";
                    return (
                      <tr key={d.request_pda} className="hover:bg-slate-50/70 transition">
                        <td className="py-3 font-semibold">
                          <Link href={`/requests/${d.request_pda}`} className="text-blue-600 hover:underline">
                            {shortKey(d.request_pda, 6)}
                          </Link>
                        </td>
                        <td className="py-3 text-slate-700 font-sans">
                          {d.program_name ?? shortKey(d.request?.program_hash, 6)}
                        </td>
                        <td className="py-3">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                              won
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : lost
                                ? "bg-rose-50 text-rose-700 border-rose-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            }`}
                          >
                            {d.status}
                          </span>
                        </td>
                        <td className="py-3 text-slate-600">{shortKey(d.claimed_output_hash, 8)}</td>
                        <td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`font-semibold ${
                                d.support_count >= required ? "text-emerald-600" : "text-slate-700"
                              }`}
                            >
                              {d.support_count}/{required}
                            </span>
                            <span className="text-slate-400 text-[10px]">({d.attestation_total} total)</span>
                          </div>
                        </td>
                        <td className="py-3">
                          {d.status === "Open" ? (
                            <Countdown
                              endsAt={d.window_ends_at}
                              className={
                                (d.seconds_remaining ?? 0) > 0 ? "text-amber-600 font-semibold" : "text-slate-400"
                              }
                            />
                          ) : (
                            <span className="text-slate-400">Resolved</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            {d.open_explorer && (
                              <a
                                href={d.open_explorer}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-blue-600 hover:underline text-[11px]"
                              >
                                Open <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            {d.resolve_explorer && (
                              <a
                                href={d.resolve_explorer}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-emerald-600 hover:underline text-[11px]"
                              >
                                Slashed <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* =========================================================================
            SECTION 4: WORKER DISPATCHER & NETWORK PARAMETERS
            ========================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <section className="lg:col-span-3 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Play className="w-4 h-4 text-blue-600" /> Autonomous Worker Dispatcher
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Trigger autonomous worker loops immediately to simulate asynchronous node ticks.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { id: "provider", label: "Provider Daemon", desc: "Claims open jobs & submits receipts" },
                { id: "verifier", label: "Verifier Quorum", desc: "Re-executes WASM & posts attestations" },
                { id: "finalizer", label: "Finalizer Daemon", desc: "Opens disputes & executes stake slashing" },
                { id: "indexer", label: "Chain Indexer", desc: "Syncs Solana on-chain PDAs into database" },
              ].map((worker) => (
                <button
                  key={worker.id}
                  onClick={() => triggerWorker(worker.id)}
                  disabled={activeJob === worker.id}
                  className="flex flex-col items-start px-4 py-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200/90 disabled:opacity-50 text-left transition group"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                    <Play className={`w-3.5 h-3.5 text-blue-600 ${activeJob === worker.id ? "animate-spin" : ""}`} />
                    {activeJob === worker.id ? "Executing Tick..." : worker.label}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">{worker.desc}</div>
                </button>
              ))}
            </div>
            {jobResult && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700 break-words">
                {jobResult}
              </div>
            )}
          </section>

          <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-blue-600" /> Solana Cluster Parameters
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Live state read from on-chain Config account.</p>
            </div>
            <dl className="space-y-2.5 text-xs">
              <Row label="Verifier Quorum" value={cfg ? `${cfg.required_attestations} attestations` : "2 of 3"} />
              <Row label="Challenge Window" value={cfg ? fmtSeconds(cfg.challenge_window_secs) : "120s"} />
              <Row
                label="Provider Stake"
                value={cfg ? `${lamportsToSol(cfg.min_provider_stake).toFixed(2)} SOL` : "0.50 SOL"}
              />
              <Row
                label="Dispute Stake"
                value={cfg ? `${lamportsToSol(cfg.min_dispute_stake).toFixed(2)} SOL` : "0.05 SOL"}
              />
              <Row label="Total Requests" value={cfg ? String(cfg.request_count) : "0"} />
            </dl>

            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400" /> Staked Provider Key
                </span>
                <span
                  className={`font-mono font-semibold ${
                    config.data?.provider.registered ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {config.data?.provider.registered ? "Registered & Staked" : "Unregistered"}
                </span>
              </div>
              <div className="space-y-1.5">
                {(config.data?.verifiers ?? []).map((v, i) => (
                  <div key={v.pubkey} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      Verifier #{i + 1} <span className="font-mono text-slate-400">{shortKey(v.pubkey, 4)}</span>
                    </span>
                    <span className={`font-mono font-semibold ${v.active ? "text-emerald-600" : "text-rose-600"}`}>
                      {v.active ? `Active (${v.attestations} att.)` : "Inactive"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* =========================================================================
            SECTION 5: STORAGE TAMPER SANDBOX
            ========================================================================= */}
        <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Database className="w-4 h-4 text-amber-600" /> Off-Chain Storage Tamper Sandbox
              </h2>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                Directly corrupt an input or output JSON blob in Supabase Storage for a given request PDA. Proves that off-chain data mutation is immediately flagged by on-chain cryptographic SHA-256 commitments.
              </p>
            </div>
            <span className="text-xs font-mono text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-xl">
              Zero-Trust Verification
            </span>
          </div>

          <form onSubmit={handleTamperBlob} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-slate-500 mb-1">Request PDA Address</label>
                <input
                  type="text"
                  placeholder="Paste Request PDA (e.g. from the simulation theater above)"
                  value={tamperPda}
                  onChange={(e) => setTamperPda(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Target Blob</label>
                <select
                  value={tamperTarget}
                  onChange={(e) => setTamperTarget(e.target.value as "input" | "output")}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                >
                  <option value="output">Output Blob (Receipt)</option>
                  <option value="input">Input Blob (Committed)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={tamperLoading || !tamperPda.trim()}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-xs font-bold text-white transition flex items-center gap-2 shadow-xs"
              >
                {tamperLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Corrupting Blob...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" /> Corrupt {tamperTarget} Blob In Storage
                  </>
                )}
              </button>
              <span className="text-xs text-slate-500">
                Mutates data in Supabase storage to trigger mismatch against immutable on-chain SHA-256.
              </span>
            </div>
          </form>

          {tamperError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-mono break-words">
              {tamperError}
            </div>
          )}

          {tamperResult && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="font-bold text-amber-700">Storage Blob Corrupted Successfully</span>
                {tamperResult.url && (
                  <a
                    href={tamperResult.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                  >
                    View In Storage <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-400 text-[11px]">Original Committed Hash:</span>
                  <div className="truncate text-emerald-600 font-semibold mt-0.5">{tamperResult.original_hash}</div>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px]">New Tampered Blob Hash:</span>
                  <div className="truncate text-rose-600 font-semibold mt-0.5">{tamperResult.tampered_hash}</div>
                </div>
              </div>
              <div className="text-slate-600 break-words pt-1">
                <span className="text-slate-400">Payload mutation applied: </span>
                {JSON.stringify(tamperResult.change)}
              </div>
            </div>
          )}
        </section>

        {/* =========================================================================
            SECTION 6: AUDIT FEED & OFFLINE AUDITOR CLI
            ========================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <section className="lg:col-span-3 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" /> Hash-Chained Cryptographic Audit Feed
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">Append-only audit ledger with cryptographic row hashes.</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live Polling
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono text-left">
                <thead className="border-b border-slate-100 text-slate-400">
                  <tr>
                    <th className="py-2 font-medium">Event Type</th>
                    <th className="py-2 font-medium">Request PDA</th>
                    <th className="py-2 font-medium">Actor</th>
                    <th className="py-2 font-medium text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-600">
                  {(activity.data ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-400 italic">
                        No audit events logged yet.
                      </td>
                    </tr>
                  ) : (
                    (activity.data ?? []).map((ev) => (
                      <tr key={ev.seq} className="hover:bg-slate-50/70">
                        <td className="py-2.5 font-semibold text-emerald-600">{ev.event_type}</td>
                        <td className="py-2.5">
                          {ev.request_pda ? (
                            <Link href={`/requests/${ev.request_pda}`} className="text-blue-600 hover:underline">
                              {shortKey(ev.request_pda, 6)}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2.5 text-slate-400 truncate max-w-[120px]">{shortKey(ev.actor, 5)}</td>
                        <td className="py-2.5 text-slate-400 text-right">
                          {ev.created_at ? new Date(ev.created_at).toLocaleTimeString() : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-slate-700" /> Offline Auditor CLI
              </h2>
              <button
                onClick={() =>
                  copyToClipboard(`python backend/scripts/verity_cli.py verify ${tamperPda.trim() || "<REQUEST_PDA>"}`, "cli")
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:text-slate-900 transition"
              >
                <Copy className="w-3.5 h-3.5" /> {copied === "cli" ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 space-y-2 overflow-x-auto">
              <div className="text-slate-500"># Independent zero-trust cryptographic audit in local wasmtime:</div>
              <div className="text-emerald-400 font-semibold break-all">
                python backend/scripts/verity_cli.py verify {tamperPda.trim() || "<REQUEST_PDA>"}
              </div>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Verifies on-chain receipt signatures, re-runs bytecode in wasmtime, and proves consensus adherence without trusting the web frontend or database.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-slate-500 pt-4 border-t border-slate-200">
          <span>
            Program Core <span className="font-mono text-slate-700">{shortKey(env.programId, 6)}</span> on Solana {env.cluster}
          </span>
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-blue-600 font-semibold hover:underline">
            Back to Dashboard <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono font-semibold text-slate-800">{value}</dd>
    </div>
  );
}
