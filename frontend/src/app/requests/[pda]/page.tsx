"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Fingerprint, History, Loader2, Users } from "lucide-react";

import { AppShell } from "@/components/ui/efferd-dashboard-2-utils/app-shell";
import { AttestationsTable } from "@/components/verify/AttestationsTable";
import { BrowserVerifyPanel } from "@/components/verify/BrowserVerifyPanel";
import { ArtifactLinks, CommitmentsTable, TamperBanner } from "@/components/verify/CommitmentsTable";
import { DisputePanel } from "@/components/verify/DisputePanel";
import { ReceiptPanel } from "@/components/verify/ReceiptPanel";
import { ShareCard } from "@/components/verify/ShareCard";
import { StatusStepper } from "@/components/verify/StatusStepper";
import { Timeline } from "@/components/verify/Timeline";
import { TraceAnalysisPanel } from "@/components/verify/TraceAnalysisPanel";
import { commitmentsOf, type RequestDetail } from "@/components/verify/types";
import { ExtLink, HashValue, Panel, StatusBadge, useFetchJson } from "@/components/verify/ui";
import { ZkPanel } from "@/components/verify/ZkPanel";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { lamportsToSol, shortKey } from "@/lib/solana";
import type { LocalVerifyResult } from "@/lib/verify";

const POLL_MS = 5000;

function PageState({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center text-sm text-slate-500">{children}</div>;
}

export default function RequestDetailPage() {
  const params = useParams<{ pda: string }>();
  const pda = decodeURIComponent(params?.pda ?? "");
  const [pollMs, setPollMs] = useState<number | undefined>(POLL_MS);
  const { data: detail, error, loading, reload } = useApi<RequestDetail>(pda ? `/requests/${pda}` : null, pollMs);
  const [local, setLocal] = useState<LocalVerifyResult | null>(null);

  // Stop polling once the request reaches a terminal state.
  useEffect(() => {
    setPollMs(detail?.is_terminal ? undefined : POLL_MS);
  }, [detail?.is_terminal]);

  const outputUrl = detail?.receipt?.output_url ?? (detail?.chain_receipt || detail?.receipt ? detail?.artifacts.output.url : null);
  const output = useFetchJson(outputUrl);

  if (!detail) {
    return (
      <AppShell>
        {loading || !error ? (
          <PageState>
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            Loading request…
          </PageState>
        ) : (
          <PageState>
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            <p className="font-medium text-slate-800">
              {error instanceof ApiError && error.status === 404 ? "Request not found" : "Could not load request"}
            </p>
            <p className="max-w-md break-words">{error.message}</p>
            <Link href="/dashboard" className="text-blue-600 hover:underline">
              Back to dashboard
            </Link>
          </PageState>
        )}
      </AppShell>
    );
  }

  const c = commitmentsOf(detail);
  const title = detail.program?.name ?? detail.request?.title ?? "Computation request";
  const hasReceipt = !!(detail.chain_receipt || detail.receipt);

  return (
    <AppShell>
      <div className="space-y-6 pb-12">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
        </Link>

        {/* Header */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Verifiable computation</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">{title}</h1>
                {detail.request?.title && detail.program?.name && <p className="text-sm text-slate-500">{detail.request.title}</p>}
              </div>
              <StatusBadge status={detail.status} size="lg" />
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
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
                <dd className="text-lg font-semibold text-slate-900">{c.bounty !== null ? `${lamportsToSol(c.bounty)} SOL` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Requester</dt>
                <dd>
                  <ExtLink href={detail.links.requester} className="font-mono text-xs">
                    {shortKey(detail.chain?.requester ?? detail.request?.requester_pubkey, 6)}
                  </ExtLink>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Provider</dt>
                <dd>
                  {detail.links.provider ? (
                    <ExtLink href={detail.links.provider} className="font-mono text-xs">
                      {shortKey(c.provider, 6)}
                    </ExtLink>
                  ) : (
                    <span className="text-xs text-slate-400">not claimed yet</span>
                  )}
                </dd>
              </div>
            </dl>
            {!detail.is_terminal && (
              <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" aria-hidden /> Live — refreshing every{" "}
                {POLL_MS / 1000}s
              </p>
            )}
          </div>
          <ShareCard pda={pda} />
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <StatusStepper detail={detail} />
        </div>

        <TamperBanner detail={detail} />

        <Panel
          title="Commitments & integrity"
          icon={<Fingerprint className="h-4 w-4 text-blue-600" aria-hidden />}
          description="Every stored artifact is re-hashed by the backend and compared with what is anchored on Solana."
        >
          <CommitmentsTable detail={detail} />
          <ArtifactLinks detail={detail} />
        </Panel>

        <BrowserVerifyPanel detail={detail} onResult={setLocal} />

        <ReceiptPanel detail={detail} output={output.data} outputLoading={output.loading} outputError={output.error} />

        <ZkPanel
          pda={pda}
          zk={detail.zk}
          inputUrl={detail.artifacts.input.url}
          receiptOutputHash={c.outputHash}
          receiptOutput={output.data}
          onVerified={reload}
        />

        <Panel
          title={`Verifier attestations (${detail.attestations.length}/${detail.challenge?.required_attestations ?? "?"})`}
          icon={<Users className="h-4 w-4 text-emerald-600" aria-hidden />}
          description="Independent staked verifiers re-execute the program and attest on-chain whether they reproduce the receipt."
        >
          <AttestationsTable rows={detail.attestations} required={detail.challenge?.required_attestations} />
        </Panel>

        <TraceAnalysisPanel pda={pda} hasReceipt={hasReceipt} />

        <DisputePanel
          pda={pda}
          status={detail.status}
          receiptOutputHash={c.outputHash}
          suggestedHash={local?.myHash ?? null}
          dispute={detail.dispute}
          chainDispute={detail.chain_dispute}
          challenge={detail.challenge}
          onDone={reload}
        />

        <Panel title="Timeline" icon={<History className="h-4 w-4 text-slate-500" aria-hidden />}>
          <Timeline items={detail.timeline} />
        </Panel>

        {error && <p className="text-xs text-amber-700">Last refresh failed: {error.message} — showing last known data.</p>}
      </div>
    </AppShell>
  );
}
