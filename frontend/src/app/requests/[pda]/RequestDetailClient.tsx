"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Fingerprint, History, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

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
import { ExtLink, fmtTime, HashValue, Panel, StatusBadge, useFetchJson } from "@/components/verify/ui";
import { ZkPanel } from "@/components/verify/ZkPanel";
import { ApiError, apiGet } from "@/lib/api";
import { LIVE_SAFETY_MS } from "@/lib/hooks";
import { useLiveTables, type LiveSpec } from "@/lib/realtime";
import { lamportsToSol, shortKey } from "@/lib/solana";
import type { LocalVerifyResult } from "@/lib/verify";

const POLL_MS = 4000;
// Integrity re-hashes every stored blob server-side, so refresh it less often than the status poll.
const INTEGRITY_EVERY_MS = 20000;

/**
 * Keeps the request fresh. Supabase Realtime pushes every change to this request's rows
 * (request, receipt, attestations, dispute, audit events) and triggers a reload; polling is the
 * fallback while Realtime is not connected. Cheap reloads skip the integrity check and keep the
 * last integrity report; a full check runs on load, whenever the status changes, and every 20 s.
 * Polling stops once the request is settled (Verified / Rejected / Expired).
 */
function useRequestDetail(pda: string) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const lastFullAt = useRef(0);
  const lastStatus = useRef<string | null | undefined>(undefined);

  const load = useCallback(
    async (forceFull = false) => {
      if (!pda || inFlight.current) return;
      inFlight.current = true;
      const fetchDetail = (withIntegrity: boolean) =>
        apiGet<RequestDetail>(`/requests/${encodeURIComponent(pda)}?integrity=${withIntegrity}`);
      try {
        let full = forceFull || Date.now() - lastFullAt.current >= INTEGRITY_EVERY_MS;
        let res = await fetchDetail(full);
        if (!full && lastStatus.current !== undefined && res.status !== lastStatus.current) {
          // Status moved since the last integrity check: re-check now so badges reflect the new artifacts.
          full = true;
          res = await fetchDetail(true);
        }
        if (full) lastFullAt.current = Date.now();
        lastStatus.current = res.status;
        setDetail((prev) => ({ ...res, integrity: full ? res.integrity : (res.integrity ?? prev?.integrity ?? null) }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        inFlight.current = false;
      }
    },
    [pda],
  );

  const terminal = detail?.is_terminal ?? false;
  const liveSpecs = useMemo<LiveSpec[]>(() => {
    const filter = `request_pda=eq.${pda}`;
    return (["requests", "receipts", "attestations", "disputes", "audit_log"] as const).map((table) => ({ table, filter }));
  }, [pda]);
  // Settled requests can still change (late audit rows, anchoring), so stay subscribed.
  const live = useLiveTables(pda ? liveSpecs : null, load);
  useEffect(() => {
    load(true);
  }, [load]);
  useEffect(() => {
    if (terminal) return;
    const t = setInterval(() => load(), live ? LIVE_SAFETY_MS : POLL_MS);
    return () => clearInterval(t);
  }, [load, terminal, live]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  return { detail, error, refresh, refreshing, live };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

export default function RequestDetailClient({ pda }: { pda: string }) {
  const { detail, error, refresh, refreshing, live } = useRequestDetail(pda);
  const [local, setLocal] = useState<LocalVerifyResult | null>(null);
  const outputUrl = detail?.receipt?.output_url ?? detail?.artifacts.output.url ?? null;
  const output = useFetchJson(outputUrl);

  if (!detail) {
    return (
      <AppShell>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center text-sm text-slate-500">
          {!error ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              <span className="font-mono">Loading request {shortKey(pda, 6)}…</span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-6 w-6 text-amber-500" />
              <p className="font-medium text-slate-800">
                {error instanceof ApiError && error.status === 404 ? "Request not found" : "Could not load request"}
              </p>
              <p className="max-w-md break-words">{error.message}</p>
              <button onClick={refresh} className="text-blue-600 hover:underline">
                Retry
              </button>
            </>
          )}
        </div>
      </AppShell>
    );
  }

  const c = commitmentsOf(detail);
  const hasReceipt = !!(detail.chain_receipt || detail.receipt);
  const matchCount = detail.attestations.filter((a) => a.matches).length;
  const required = detail.challenge?.required_attestations ?? null;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-xs transition hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
          </Link>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {error && <span className="text-amber-600">Live update failed: {error.message}</span>}
            {!detail.is_terminal && (
              <span
                className="inline-flex items-center gap-1.5"
                title={live ? "Pushed by Supabase Realtime" : "Realtime unavailable: polling every few seconds"}
              >
                <span className={`h-2 w-2 animate-pulse rounded-full ${live ? "bg-emerald-500" : "bg-blue-500"}`} />
                {live ? "Live" : "Polling"}
              </span>
            )}
            <button
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 shadow-xs transition hover:text-slate-900 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Computation request</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">
                  {detail.program?.name ?? detail.request?.title ?? "Computation request"}
                </h1>
              </div>
              <StatusBadge status={detail.status} size="lg" />
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              <Fact label="Request PDA">
                <span className="flex items-center gap-2">
                  <HashValue value={detail.request_pda} label="request PDA" />
                  <ExtLink href={detail.links.request} className="text-xs">
                    explorer
                  </ExtLink>
                </span>
              </Fact>
              <Fact label="Requester">
                <ExtLink href={detail.links.requester} className="font-mono text-xs">
                  {shortKey(detail.chain?.requester ?? detail.request?.requester_pubkey, 6)}
                </ExtLink>
              </Fact>
              <Fact label="Provider">
                {detail.links.provider ? (
                  <ExtLink href={detail.links.provider} className="font-mono text-xs">
                    {shortKey(c.provider, 6)}
                  </ExtLink>
                ) : (
                  <span className="text-xs text-slate-400">not claimed yet</span>
                )}
              </Fact>
              <Fact label="Bounty">{c.bounty !== null ? `${lamportsToSol(c.bounty)} SOL` : "—"}</Fact>
              <Fact label="Verifier attestations">
                {matchCount} match / {detail.attestations.length} total
                {required ? <span className="text-slate-400"> · {required} needed</span> : null}
              </Fact>
              <Fact label="Created">{fmtTime(detail.request?.created_at ?? detail.chain?.created_at)}</Fact>
            </dl>
            {detail.zk?.record && (
              <p className={`mt-4 text-sm font-semibold ${detail.zk.record.matches_receipt ? "text-emerald-700" : "text-red-700"}`}>
                {detail.zk.record.matches_receipt ? "zk-verified on Solana (Groth16)" : "Receipt proven wrong by a zk fraud proof"}
              </p>
            )}
          </div>
          <ShareCard pda={pda} />
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <StatusStepper detail={detail} />
        </div>

        <TamperBanner detail={detail} />

        <BrowserVerifyPanel detail={detail} onResult={setLocal} />

        <DisputePanel
          pda={pda}
          status={detail.status}
          receiptOutputHash={c.outputHash}
          suggestedHash={local?.myHash ?? null}
          dispute={detail.dispute}
          chainDispute={detail.chain_dispute}
          challenge={detail.challenge}
          onDone={refresh}
        />

        <ReceiptPanel detail={detail} output={output.data} outputLoading={output.loading} outputError={output.error} />

        <Panel
          title="Verifier attestations"
          icon={<ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden />}
          description="Independent verifiers re-execute the program and record their result on-chain. Only registered verifiers count toward quorum."
        >
          <AttestationsTable rows={detail.attestations} required={required} />
        </Panel>

        <Panel
          title="On-chain commitments"
          icon={<Fingerprint className="h-4 w-4 text-blue-600" aria-hidden />}
          description="Hashes read from Solana; every stored artifact is re-hashed and checked against them."
        >
          <CommitmentsTable detail={detail} />
          <ArtifactLinks detail={detail} />
        </Panel>

        <TraceAnalysisPanel pda={pda} hasReceipt={hasReceipt} />

        <ZkPanel
          pda={pda}
          zk={detail.zk}
          inputUrl={detail.artifacts.input.url}
          receiptOutputHash={c.outputHash}
          receiptOutput={output.data}
          onVerified={refresh}
        />

        <Panel
          title="Execution timeline"
          icon={<History className="h-4 w-4 text-slate-500" aria-hidden />}
          description="Every step of this request, with links to the Solana transactions that recorded it."
        >
          <Timeline items={detail.timeline} />
        </Panel>

        <p className="text-center text-xs text-slate-400">
          Cluster {detail.cluster} · program <ExtLink href={detail.links.program}>{shortKey(detail.program_id, 6)}</ExtLink>
        </p>
      </div>
    </AppShell>
  );
}
