"use client";

import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  FileSignature,
  Fingerprint,
  Gavel,
  History,
  Loader2,
  LockKeyhole,
  LogOut,
  MonitorCheck,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Swords,
  Users,
  Zap,
} from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import type { AuditLogRow, Program, Stats } from "@/lib/api";
import { env, explorerAddress } from "@/lib/env";
import { useApi } from "@/lib/hooks";
import { shortKey } from "@/lib/solana";

const STEPS = [
  {
    icon: Fingerprint,
    title: "Commit",
    body: "The requester commits SHA-256 hashes of the exact WASM program and canonical JSON input on Solana, with a bounty in escrow.",
  },
  {
    icon: Cpu,
    title: "Execute",
    body: "A staked provider runs the program in a deterministic sandbox: no I/O, no clock, no randomness, metered fuel.",
  },
  {
    icon: FileSignature,
    title: "Receipt",
    body: "The provider signs a receipt (output hash, trace root, fuel) with Ed25519. Solana checks the signature on-chain.",
  },
  {
    icon: Users,
    title: "Re-execute",
    body: "Independent verifiers, and you in your own browser, re-run the same program on the same input and attest the result.",
  },
  {
    icon: Gavel,
    title: "Dispute",
    body: "If the hashes disagree, anyone can stake a challenge. A verifier quorum settles it and the dishonest side is slashed.",
  },
];

const GUARANTEES = [
  {
    icon: MonitorCheck,
    title: "Verify in your browser",
    body: "Re-execute any result locally and compare hashes against the chain. You never have to trust our server.",
  },
  {
    icon: LockKeyhole,
    title: "Input & output integrity",
    body: "Every stored artifact is content-addressed and re-hashed on display. Tampering shows up as a red banner.",
  },
  {
    icon: ScrollText,
    title: "Tamper-evident records",
    body: "Requests, receipts, attestations and disputes live on Solana. The off-chain audit log is hash-chained and anchored on-chain.",
  },
  {
    icon: History,
    title: "Execution traceability",
    body: "A Merkle trace of each run pinpoints the first divergent step, and every lifecycle event links to its transaction.",
  },
  {
    icon: Swords,
    title: "Adversarially tested",
    body: "Malicious providers, swapped programs, forged signatures, tampered blobs and lazy verifiers are all caught.",
  },
  {
    icon: Sparkles,
    title: "Zero-knowledge proofs",
    body: "Payroll results can be proven with a Groth16 proof verified on Solana, with no re-execution needed.",
  },
];

function fmtCount(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : n.toLocaleString();
}

function Nav() {
  const { user, loading, displayName, signOut } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-blue-100/60 bg-white/75 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-slate-900 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm transition-transform group-hover:scale-105">
            <ShieldCheck className="h-4 w-4 text-blue-400" aria-hidden />
          </div>
          <span className="text-base tracking-tight font-semibold">Verity</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
          <a href="#features" className="hover:text-slate-900 transition-colors">
            Features
          </a>
          <a href="#how" className="hover:text-slate-900 transition-colors">
            How It Works
          </a>
          <Link href="/rulesets" className="hover:text-slate-900 transition-colors">
            Rule sets
          </Link>
          <Link href="/activity" className="hover:text-slate-900 transition-colors">
            Audit trail
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          {loading ? null : user ? (
            <>
              <span className="hidden max-w-[12rem] truncate text-xs text-slate-500 sm:inline">{displayName}</span>
              <button
                onClick={signOut}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-md shadow-blue-500/20 hover:bg-blue-500 transition-all hover:shadow-lg"
              >
                Open app <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="hidden sm:inline-block rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-md shadow-blue-500/20 hover:bg-blue-500 transition-all hover:shadow-lg"
              >
                Get Started <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function LiveStats() {
  const { data, error, loading } = useApi<Stats>("/stats", 15000, [{ table: "requests" }, { table: "disputes" }, { table: "programs" }]);
  const tiles = [
    { label: "Computation requests", value: fmtCount(data?.total_requests) },
    {
      label: "Verified",
      value: data ? (data.verified_pct === null ? "—" : `${Math.round(data.verified_pct)}%`) : "—",
      sub: data ? `${fmtCount(data.verified)} of ${fmtCount(data.verified + data.rejected)} settled` : undefined,
    },
    {
      label: "Frauds caught",
      value: fmtCount(data?.disputes_caught),
      sub: data ? `${fmtCount(data.rejected)} requests rejected` : undefined,
    },
    { label: "Verifier attestations", value: fmtCount(data?.attestations) },
  ];
  return (
    <div className="rounded-3xl border border-blue-100/80 bg-white/85 p-6 sm:p-8 shadow-xl shadow-blue-500/5 backdrop-blur-md text-left">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-2 font-semibold uppercase tracking-wider text-slate-600">
          {error && !data ? (
            <span className="h-2 w-2 rounded-full bg-slate-300" />
          ) : (
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          )}
          Live on Solana {env.cluster}
        </span>
        {loading && !data && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-label="Loading stats" />}
        {error && !data && <span className="text-slate-400">Stats unavailable right now</span>}
      </div>
      <dl className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="border-l-2 border-blue-100 pl-4 sm:pl-5">
            <dt className="text-xs font-medium text-slate-500">{t.label}</dt>
            <dd className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums text-slate-900 tracking-tight">{t.value}</dd>
            {t.sub && <dd className="mt-0.5 text-[11px] text-slate-400">{t.sub}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

function RuleSets() {
  const { data, error, loading } = useApi<Program[]>("/programs", undefined, [{ table: "programs" }]);
  const items = (data ?? []).slice(0, 6);
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Rule sets ready to run</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Deterministic WebAssembly programs with integer-only maths, so every machine and browser computes bit-identical output.
          </p>
        </div>
        <Link href="/rulesets" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
          All rule sets <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      {loading && !data ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading rule sets…
        </p>
      ) : error && !data ? (
        <p className="text-sm text-slate-500">Rule sets are unavailable right now.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No rule sets registered yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <Link
              key={p.program_hash}
              href={`/create-job?program=${encodeURIComponent(p.program_hash)}`}
              className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow"
            >
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-blue-600" aria-hidden />
                <span className="font-semibold text-slate-900">{p.name}</span>
              </div>
              {p.description && <p className="mt-2 line-clamp-3 text-sm text-slate-600">{p.description}</p>}
              <div className="mt-auto flex items-center justify-between pt-4 text-xs">
                <code className="font-mono text-slate-400">sha256 {shortKey(p.program_hash, 6)}</code>
                <span className="font-semibold text-blue-600 group-hover:underline">Run it →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function RecentActivity() {
  const { data, error } = useApi<AuditLogRow[]>("/activity?limit=8", 15000, [{ table: "audit_log" }]);
  if (error && !data) return null;
  const rows = data ?? [];
  return (
    <section className="border-y border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Happening now</h2>
            <p className="mt-1 text-sm text-slate-600">The latest entries in the hash-chained audit log, each linked to its Solana transaction.</p>
          </div>
          <Link href="/activity" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
            Full audit trail <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{data ? "No activity yet." : "Loading…"}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {rows.map((r) => (
              <li key={r.seq} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="font-mono text-xs text-slate-400">#{r.seq}</span>
                  <span className="font-medium text-slate-900">{r.event_type}</span>
                  {r.request_pda && (
                    <Link href={`/verify/${r.request_pda}`} className="font-mono text-xs text-blue-600 hover:underline">
                      {shortKey(r.request_pda, 5)}
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <time>{new Date(r.created_at).toLocaleString()}</time>
                  {r.explorer && (
                    <a href={r.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-600 hover:underline">
                      tx <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function LandingPage() {
  const programUrl = explorerAddress(env.programId);
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#ffffff] via-[#f4f7fe] to-[#dce8fe]/60 text-slate-900">
      <Nav />

      <main>
        <section className="relative overflow-hidden pt-12 pb-20 sm:pt-20 sm:pb-28">
          {/* Ethereal light ambient glow matching the reference design */}
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_35%,rgba(191,219,254,0.45),rgba(255,255,255,0))]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-blue-100/50 via-sky-50/20 to-transparent"
            aria-hidden
          />

          <div className="relative mx-auto max-w-5xl px-4 flex flex-col items-center text-center">
            {/* Top pill badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200/70 bg-white/80 px-4 py-1.5 text-xs sm:text-sm font-medium text-slate-700 shadow-sm backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-blue-600" />
              <span>Blockchain Verified on Solana</span>
            </div>

            {/* Headline with glowing gradient accents */}
            <h1 className="mt-8 text-5xl sm:text-7xl md:text-8xl font-normal tracking-tight text-slate-900 leading-[1.08] max-w-4xl">
              Prove{" "}
              <span className="font-normal bg-gradient-to-r from-blue-600 via-sky-500 to-blue-500 bg-clip-text text-transparent">
                computation
              </span>
              <br />
              without the{" "}
              <span className="font-normal bg-gradient-to-r from-blue-600 via-sky-500 to-blue-500 bg-clip-text text-transparent">
                risk.
              </span>
            </h1>

            {/* Subtitle */}
            <p className="mt-6 max-w-2xl text-center text-base sm:text-lg text-slate-600 leading-relaxed font-normal">
              Execute deterministic workloads anchored on the Solana blockchain. If it&apos;s verified, settle instantly with cryptographic finality. If it&apos;s tampered, the chain catches and slashes it.
            </p>

            {/* The 4 Feature Pills matching the reference */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              <div className="inline-flex items-center gap-2.5 rounded-xl border border-blue-100/90 bg-white/90 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-medium text-slate-700 shadow-sm backdrop-blur">
                <ShieldCheck className="h-4 w-4 text-blue-600" aria-hidden />
                <span>Tamper-Proof Execution</span>
              </div>
              <div className="inline-flex items-center gap-2.5 rounded-xl border border-blue-100/90 bg-white/90 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-medium text-slate-700 shadow-sm backdrop-blur">
                <Zap className="h-4 w-4 text-blue-600" aria-hidden />
                <span>Solana Secured</span>
              </div>
              <div className="inline-flex items-center gap-2.5 rounded-xl border border-blue-100/90 bg-white/90 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-medium text-slate-700 shadow-sm backdrop-blur">
                <CheckCircle2 className="h-4 w-4 text-blue-600" aria-hidden />
                <span>Instantly Verifiable</span>
              </div>
              <div className="inline-flex items-center gap-2.5 rounded-xl border border-blue-100/90 bg-white/90 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-medium text-slate-700 shadow-sm backdrop-blur">
                <Database className="h-4 w-4 text-blue-600" aria-hidden />
                <span>Permanent Record</span>
              </div>
            </div>

            {/* Action CTA buttons */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
              <Link
                href="/create-job"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-500 hover:shadow-lg transition-all"
              >
                Submit a computation <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/activity"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white/90 px-6 py-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-white hover:border-slate-300 transition-all backdrop-blur"
              >
                Browse verified results
              </Link>
            </div>

            {/* Live Stats Card */}
            <div className="mt-14 w-full max-w-4xl">
              <LiveStats />
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-16 border-y border-slate-200/80 bg-white/70 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="text-2xl font-bold text-slate-900">How Verity works</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Commit, execute, sign, re-execute, dispute: the same optimistic-verification idea behind rollup fraud proofs, applied to
              everyday computations.
            </p>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                      {i + 1}
                    </span>
                    <s.icon className="h-4 w-4 text-blue-600" aria-hidden />
                  </div>
                  <h3 className="mt-3 font-semibold text-slate-900">{s.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" className="scroll-mt-16 mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold text-slate-900">What you get</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {GUARANTEES.map((g) => (
              <div key={g.title} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm hover:border-blue-200 transition-colors">
                <g.icon className="h-5 w-5 text-blue-600" aria-hidden />
                <h3 className="mt-3 font-semibold text-slate-900">{g.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{g.body}</p>
              </div>
            ))}
          </div>
        </section>

        <RecentActivity />

        <RuleSets />

        <section className="mx-auto max-w-6xl px-4 pb-20">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-slate-900 p-8 text-white sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-bold">Don&apos;t trust the provider. Check the work.</h2>
              <p className="mt-1 text-sm text-slate-300">Sign in with Google, connect a devnet wallet, and submit your first verifiable computation.</p>
            </div>
            <Link
              href="/create-job"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              Get started <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-slate-500">
          <span>Verity · verifiable computation on Solana {env.cluster}</span>
          <span className="flex flex-wrap gap-4">
            {programUrl && (
              <a href={programUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-slate-800">
                verity_core {shortKey(env.programId, 4)} <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
            <Link href="/rulesets" className="hover:text-slate-800">
              Rule sets
            </Link>
            <Link href="/activity" className="hover:text-slate-800">
              Audit trail
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

