"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, Fingerprint, Loader2, ShieldCheck, Terminal } from "lucide-react";

import { BrowserVerifyPanel } from "@/components/verify/BrowserVerifyPanel";
import { ArtifactLinks, CommitmentsTable, TamperBanner } from "@/components/verify/CommitmentsTable";
import { ShareCard } from "@/components/verify/ShareCard";
import { StatusStepper } from "@/components/verify/StatusStepper";
import { commitmentsOf, type RequestDetail } from "@/components/verify/types";
import { ExtLink, HashValue, Panel, StatusBadge, useCopy } from "@/components/verify/ui";
import { ZkPanel } from "@/components/verify/ZkPanel";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { lamportsToSol, shortKey } from "@/lib/solana";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-slate-50 font-sans text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-white">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            </span>
            Verity
          </Link>
          <span className="text-xs text-slate-500">Public verification · no login required</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

function CliHint({ pda }: { pda: string }) {
  const cmd = `verity-cli verify ${pda}`;
  const { copied, copy } = useCopy();
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-slate-100">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <Terminal className="h-3.5 w-3.5" aria-hidden /> Verify from your terminal
      </p>
      <div className="flex items-center justify-between gap-3">
        <code className="min-w-0 break-all font-mono text-sm">{cmd}</code>
        <button type="button" onClick={() => copy(cmd)} className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function PublicVerifyContent() {
  const params = useParams<{ pda: string }>();
  const pda = decodeURIComponent(params?.pda ?? "");
  const { data: detail, error, loading } = useApi<RequestDetail>(pda ? `/requests/${pda}` : null);

  if (!detail) {
    return (
      <Shell>
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center text-sm text-slate-500">
          {loading || !error ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" /> Loading on-chain commitments…
            </>
          ) : (
            <>
              <AlertTriangle className="h-6 w-6 text-amber-500" />
              <p className="font-medium text-slate-800">
                {error instanceof ApiError && error.status === 404 ? "Request not found" : "Could not load request"}
              </p>
              <p className="max-w-md break-words">{error.message}</p>
            </>
          )}
        </div>
      </Shell>
    );
  }

  const c = commitmentsOf(detail);
  return (
    <Shell>
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Verify a computation</p>
                <h1 className="mt-1 text-2xl font-bold">{detail.program?.name ?? detail.request?.title ?? "Computation request"}</h1>
              </div>
              <StatusBadge status={detail.status} size="lg" />
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">Request PDA</dt>
                <dd className="flex items-center gap-2">
                  <HashValue value={pda} label="request PDA" />
                  <ExtLink href={detail.links.request} className="text-xs">
                    explorer
                  </ExtLink>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Bounty</dt>
                <dd className="font-semibold">{c.bounty !== null ? `${lamportsToSol(c.bounty)} SOL` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Provider</dt>
                <dd>
                  <ExtLink href={detail.links.provider} className="font-mono text-xs">
                    {shortKey(c.provider, 6)}
                  </ExtLink>
                  {!detail.links.provider && <span className="text-xs text-slate-400">not claimed yet</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Verifier attestations</dt>
                <dd>
                  {detail.attestations.filter((a) => a.matches).length} match / {detail.attestations.length} total
                </dd>
              </div>
            </dl>
            {detail.zk?.record && (
              <p className={`mt-4 text-sm font-semibold ${detail.zk.record.matches_receipt ? "text-emerald-700" : "text-red-700"}`}>
                {detail.zk.record.matches_receipt ? "zk-verified on Solana (Groth16)" : "Receipt proven wrong by a zk fraud proof"}
              </p>
            )}
          </div>
          <ShareCard pda={pda} showPageLink={false} />
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <StatusStepper detail={detail} />
        </div>

        <TamperBanner detail={detail} />

        <BrowserVerifyPanel detail={detail} />

        <Panel
          title="On-chain commitments"
          icon={<Fingerprint className="h-4 w-4 text-blue-600" aria-hidden />}
          description="The hashes below are read from Solana; every stored artifact is checked against them."
        >
          <CommitmentsTable detail={detail} />
          <ArtifactLinks detail={detail} />
        </Panel>

        <ZkPanel
          pda={pda}
          zk={detail.zk}
          inputUrl={detail.artifacts.input.url}
          receiptOutputHash={c.outputHash}
          allowSubmit={false}
        />

        <CliHint pda={pda} />

        <p className="text-center text-xs text-slate-400">
          Cluster {detail.cluster} · program <ExtLink href={detail.links.program}>{shortKey(detail.program_id, 6)}</ExtLink> ·{" "}
          <Link href={`/requests/${pda}`} className="text-blue-600 hover:underline">
            Full request page
          </Link>
        </p>
      </div>
    </Shell>
  );
}

export default function PublicVerifyPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <div className="flex min-h-[40vh] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        </Shell>
      }
    >
      <PublicVerifyContent />
    </Suspense>
  );
}
