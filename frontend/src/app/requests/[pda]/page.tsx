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
