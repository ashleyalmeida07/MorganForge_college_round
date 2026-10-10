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
"use client";

import React, { use } from 'react';
import {
  CheckCircle2, XCircle, Clock, ExternalLink, Loader2, ShieldAlert, ShieldCheck, Download,
} from 'lucide-react';

import { AppShell } from '@/components/ui/efferd-dashboard-2-utils/app-shell';
import { useApi } from '@/lib/hooks';
import type { RequestDetail, RequestStatus } from '@/lib/api';
import { shortKey } from '@/lib/solana';
import { env } from '@/lib/env';

const STEPS: RequestStatus[] = ['Open', 'Claimed', 'AwaitingVerification', 'Verified'];
const TERMINAL_BAD: RequestStatus[] = ['Rejected', 'Expired'];

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusBadgeClass(status: RequestStatus): string {
  if (status === 'Verified') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'Rejected' || status === 'Expired') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (status === 'Disputed') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

function Stepper({ status }: { status: RequestStatus }) {
  const badStatus = TERMINAL_BAD.includes(status);
  const currentIdx = badStatus ? STEPS.length - 1 : STEPS.indexOf(status === 'Disputed' ? 'AwaitingVerification' : status);
  return (
    <div className="flex items-center overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const done = i < currentIdx || (i === currentIdx && !badStatus);
        const isCurrent = i === currentIdx;
        const label = step === 'AwaitingVerification' ? 'Verification' : step;
        return (
          <React.Fragment key={step}>
            {i > 0 && <div className={`h-0.5 w-8 shrink-0 ${done ? 'bg-blue-500' : 'bg-slate-200'}`} />}
            <div className="flex flex-col items-center shrink-0">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                  isCurrent && badStatus
                    ? 'border-rose-400 bg-rose-50 text-rose-600'
                    : done
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : 'border-slate-300 bg-white text-slate-400'
                }`}
              >
                {isCurrent && badStatus ? <XCircle className="h-4 w-4" /> : i + 1}
              </div>
              <span className="mt-1 text-[11px] font-medium text-slate-600 whitespace-nowrap">{label}</span>
            </div>
          </React.Fragment>
        );
      })}
      {badStatus && (
        <span className="ml-3 shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
          {status}
        </span>
      )}
      {status === 'Disputed' && (
        <span className="ml-3 shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          Disputed
        </span>
      )}
    </div>
  );
}

function IntegrityPill({ overall }: { overall?: string }) {
  if (!overall) return null;
  if (overall === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        <ShieldCheck className="h-3.5 w-3.5" /> Integrity verified
      </span>
    );
  }
  if (overall === 'tampered') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
        <ShieldAlert className="h-3.5 w-3.5" /> TAMPERED — artifact doesn't match chain
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
      <Clock className="h-3.5 w-3.5" /> Awaiting completion
    </span>
  );
}

export default function RequestDetailPage({ params }: { params: Promise<{ pda: string }> }) {
  const { pda } = use(params);
  const { data, error, loading } = useApi<RequestDetail>(`/requests/${pda}`, 8000);

  return (
    <AppShell>
      <div className="container mx-auto py-10 max-w-4xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 truncate">
              {data?.request?.title || 'Computation request'}
            </h1>
            <p className="mt-1 font-mono text-xs text-slate-500 break-all">{pda}</p>
          </div>
          <a
            href={`${env.apiUrl}/requests/${pda}/evidence.zip`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> Evidence bundle
          </a>
        </div>

        {loading && !data ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading request…
          </div>
        ) : error && !data ? (
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <XCircle className="h-4 w-4" /> {error.message}
          </div>
        ) : data ? (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(data.status)}`}>
                  {data.status}
                </span>
                <IntegrityPill overall={data.integrity?.overall} />
                {data.program?.name && <span className="text-xs text-slate-500">· {data.program.name}</span>}
                {data.links.request && (
                  <a href={data.links.request} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    Request account <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <Stepper status={data.status} />
              {data.challenge && data.status === 'AwaitingVerification' && (
                <p className="text-xs text-slate-500">
                  Challenge window ends {fmtTime(data.challenge.ends_at)}
                  {data.challenge.seconds_remaining > 0 ? ` (${Math.ceil(data.challenge.seconds_remaining / 60)} min left)` : ''}.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Execution timeline</h2>
                <p className="text-xs text-slate-500">
                  Created → claimed → receipt → attestations → dispute → finalized, each tied to an on-chain transaction.
                </p>
              </div>
              {data.timeline.length === 0 ? (
                <div className="p-4 text-sm text-slate-500">No timeline events yet.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.timeline.map((t, i) => (
                    <li key={`${t.event_type}-${t.seq ?? i}`} className="flex items-start gap-3 px-5 py-3">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-900">{t.event_type}</span>
                          <span className="text-xs text-slate-400">{fmtTime(t.at)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          {t.actor && <span className="font-mono">{shortKey(t.actor)}</span>}
                          {t.slot != null && <span>slot {t.slot}</span>}
                          {t.explorer && (
                            <a href={t.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                              tx {shortKey(t.tx_sig, 6)} <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
