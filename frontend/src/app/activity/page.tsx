"use client";

import React, { useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, ShieldCheck, ShieldAlert, XCircle } from 'lucide-react';

import { AppShell } from '@/components/ui/efferd-dashboard-2-utils/app-shell';
import { useApi } from '@/lib/hooks';
import type { AuditLogRow, AuditVerifyOut } from '@/lib/api';
import { shortKey } from '@/lib/solana';

const SELECT_CLASS =
  'w-full sm:w-56 appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

const BAD_EVENTS = new Set([
  'InputTampered', 'OutputTampered', 'ProgramTampered', 'StorageTampered',
  'InputCommitmentMissing', 'ReceiptRejected', 'ExecutionFailed', 'WorkerError', 'DisputeOpened',
]);
const GOOD_EVENTS = new Set(['Finalized', 'DisputeResolved', 'AuditRootAnchored', 'ReceiptSubmitted', 'Attested']);

function eventBadgeClass(eventType: string): string {
  if (BAD_EVENTS.has(eventType)) return 'bg-rose-50 text-rose-600';
  if (GOOD_EVENTS.has(eventType)) return 'bg-emerald-50 text-emerald-600';
  return 'bg-slate-100 text-slate-600';
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function IntegrityBanner({ verify }: { verify: ReturnType<typeof useApi<AuditVerifyOut>> }) {
  if (verify.loading && !verify.data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Verifying hash-chained audit log…
      </div>
    );
  }
  if (verify.error && !verify.data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
        <XCircle className="h-4 w-4" /> Could not verify audit chain: {verify.error.message}
      </div>
    );
  }
  const v = verify.data;
  if (!v) return null;
  const ok = v.ok_overall;
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 font-medium">
        {ok ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        {ok
          ? `Audit log chain verified ✅ (${v.checked} rows checked, no breaks)`
          : `Audit log integrity problem ❌${v.first_bad_seq != null ? ` — chain breaks at row #${v.first_bad_seq}` : ''}`}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-90">
        <span>
          On-chain anchor:{' '}
          {v.onchain.available
            ? v.anchor_status === 'ok'
              ? 'matches DB ✅'
              : v.anchor_status === 'not_anchored'
                ? 'not anchored yet'
                : 'root not found in DB ⚠️'
            : 'config unavailable'}
          {v.onchain.audit_root_count != null && ` (root #${v.onchain.audit_root_count})`}
        </span>
        {v.anchored_row?.explorer && (
          <a href={v.anchored_row.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
            Last anchor tx <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function ActivityPage() {
  const verify = useApi<AuditVerifyOut>('/audit/verify', 20000);
  const feed = useApi<AuditLogRow[]>('/activity?limit=200', 10000);
  const [eventType, setEventType] = useState('');

  const rows = useMemo(() => feed.data ?? [], [feed.data]);
  const eventTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.event_type))).sort(),
    [rows],
  );
  const visible = eventType ? rows.filter((r) => r.event_type === eventType) : rows;

  return (
    <AppShell>
      <div className="container mx-auto py-10 max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Activity</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Global feed from the hash-chained <code>audit_log</code> plus on-chain events. Every row is
            tamper-evident: its hash chains to the previous row, and the chain head is periodically anchored on Solana.
          </p>
        </div>

        <IntegrityBanner verify={verify} />

        <div className="flex items-center justify-between gap-3">
          <div className="relative">
            <select value={eventType} onChange={(e) => setEventType(e.target.value)} className={SELECT_CLASS}>
              <option value="">All event types</option>
              {eventTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {feed.loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          {feed.loading && !feed.data ? (
            <div className="p-4 flex items-center text-sm text-slate-500">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading activity…
            </div>
          ) : feed.error && !feed.data ? (
            <div className="p-4 flex items-center text-sm text-rose-600">
              <XCircle className="w-4 h-4 mr-2" /> {feed.error.message}
            </div>
          ) : visible.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">No activity yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visible.map((r) => (
                <li key={r.seq} className="p-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${eventBadgeClass(r.event_type)}`}>
                          {r.event_type}
                        </span>
                        <span className="text-xs text-slate-400">#{r.seq}</span>
                        {r.anchored_tx && (
                          <a
                            href={r.anchored_explorer ?? '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center text-[11px] font-medium bg-blue-50 px-2 py-0.5 rounded-full text-blue-600 hover:underline"
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" /> anchored
                          </a>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{fmtTime(r.created_at)}</span>
                        {r.actor && <span className="font-mono">{shortKey(r.actor)}</span>}
                        {r.request_pda && (
                          <a href={`/requests/${r.request_pda}`} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                            timeline
                          </a>
                        )}
                        {r.request_explorer && (
                          <a href={r.request_explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                            request <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {r.explorer && (
                          <a href={r.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                            tx <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="font-mono text-[11px] text-slate-400 shrink-0">{shortKey(r.row_hash, 6)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
