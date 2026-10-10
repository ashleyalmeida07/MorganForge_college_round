"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FileText,
  ClipboardList,
  ShieldAlert,
  BarChart3,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  ShieldCheck,
  Activity,
  Layers,
  Zap,
  TrendingUp,
  Clock,
  Sparkles
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  YAxis,
  XAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';

import { useApi } from '@/lib/hooks';
import type { RequestRow, Stats } from '@/lib/api';
import { shortKey } from '@/lib/utils';
import { env, explorerAddress, explorerTx } from '@/lib/env';

interface ActivityRow {
  seq: number;
  event_type: string;
  request_pda?: string | null;
  actor?: string | null;
  payload?: unknown;
  tx_sig?: string | null;
  slot?: number | null;
  created_at: string;
  explorer?: string | null;
  request_explorer?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DONE = new Set(['Verified', 'Rejected']);

const ts = (s?: string | null) => {
  if (!s) return NaN;
  return new Date(s).getTime();
};

const fmtNum = (n?: number | null) => (n == null ? '—' : n.toLocaleString());

function timeAgo(s?: string | null, now?: number | null) {
  const t = ts(s);
  if (Number.isNaN(t)) return '—';
  if (!now) return '—';
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function niceTicks(max: number) {
  const step = Math.max(1, Math.ceil(max / 4));
  return [0, step, step * 2, step * 3, step * 4];
}

export function Dashboard() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
  }, []);

  const { data: stats, error: statsError, loading: statsLoading } = useApi<Stats>('/stats', 15000);
  const { data: requests, error: reqError } = useApi<RequestRow[]>('/requests?scope=all&limit=200', 30000);
  const { data: activity, error: actError } = useApi<ActivityRow[]>('/activity?limit=20', 15000);

  const backendError = statsError ?? reqError ?? actError;
  const online = !statsError && !!stats;

  const throughputData = useMemo(() => {
    if (!now) {
      return Array.from({ length: 8 }, (_, i) => ({
        name: `W${i + 1}`,
        opened: 0,
        completed: 0,
      }));
    }
    const start = now - 8 * WEEK_MS;
    const buckets = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(start + i * WEEK_MS);
      return {
        name: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        opened: 0,
        completed: 0,
      };
    });
    const idx = (t: number) => {
      if (Number.isNaN(t) || t < start || t > now) return -1;
      return Math.min(7, Math.floor((t - start) / WEEK_MS));
    };
    for (const r of requests ?? []) {
      const o = idx(ts(r.created_at));
      if (o >= 0) buckets[o].opened += 1;
      if (DONE.has(r.status)) {
        const c = idx(ts(r.updated_at));
        if (c >= 0) buckets[c].completed += 1;
      }
    }
    return buckets;
  }, [requests, now]);

  const throughputTicks = useMemo(
    () => niceTicks(Math.max(0, ...throughputData.map((d) => Math.max(d.opened, d.completed)))),
    [throughputData],
  );

  const dailyData = useMemo(() => {
    if (!now) {
      return Array.from({ length: 7 }, (_, i) => ({
        name: WEEKDAYS[i],
        value: 0,
      }));
    }
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const first = today.getTime() - 6 * DAY_MS;
    const days = Array.from({ length: 7 }, (_, i) => ({
      name: WEEKDAYS[new Date(first + i * DAY_MS).getDay()],
      value: 0,
    }));
    for (const r of requests ?? []) {
      const t = ts(r.created_at);
      if (Number.isNaN(t) || t < first) continue;
      const i = Math.floor((t - first) / DAY_MS);
      if (i >= 0 && i < 7) days[i].value += 1;
    }
    return days;
  }, [requests, now]);

  const loadingLine = statsLoading ? 'Querying devnet…' : '—';
  const decided = stats ? stats.verified + stats.rejected : 0;

  const statCards = [
    {
      title: 'Total Requests',
      value: fmtNum(stats?.total_requests),
      change: stats
        ? `${fmtNum(stats.by_status?.Open ?? 0)} open · ${fmtNum(stats.verified)} verified`
        : loadingLine,
      icon: FileText,
      color: 'from-blue-50/80 via-white to-white',
      border: 'border-slate-200',
      textAccent: 'text-blue-700',
      iconBg: 'bg-blue-50 text-blue-600 border-blue-100',
    },
    {
      title: 'Active In Flight',
      value: fmtNum(stats?.in_flight),
      change: stats
        ? `${fmtNum(stats.by_status?.AwaitingVerification ?? 0)} in window · ${fmtNum(stats.by_status?.Disputed ?? 0)} disputed`
        : loadingLine,
      icon: ClipboardList,
      color: 'from-indigo-50/80 via-white to-white',
      border: 'border-slate-200',
      textAccent: 'text-indigo-700',
      iconBg: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    },
    {
      title: 'Disputes Caught',
      value: fmtNum(stats?.disputes_caught),
      change: stats
        ? `${fmtNum(stats.disputes_total)} total · ${fmtNum(stats.frivolous_disputes)} frivolous slashed`
        : loadingLine,
      icon: ShieldAlert,
      color: 'from-rose-50/80 via-white to-white',
      border: 'border-slate-200',
      textAccent: 'text-rose-700',
      iconBg: 'bg-rose-50 text-rose-600 border-rose-100',
    },
    {
      title: 'Consensus Rate',
      value: stats?.verified_pct != null ? `${Math.round(stats.verified_pct)}%` : '—',
      change: stats ? `${fmtNum(stats.verified)} of ${fmtNum(decided)} settled` : loadingLine,
      icon: BarChart3,
      color: 'from-emerald-50/80 via-white to-white',
      border: 'border-slate-200',
      textAccent: 'text-emerald-700',
      iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    },
  ];

  const lastEvent = activity?.[0];
  const lastEventHref = lastEvent
    ? explorerTx(lastEvent.tx_sig) ?? explorerAddress(lastEvent.request_pda)
    : null;

  return (
    <div className="space-y-6 w-full max-w-[1280px] mx-auto pb-10">
      {/* Banner if backend notice */}
      {backendError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between font-mono">
          <span>Backend notice: {backendError.message} — displaying cached state from Solana devnet.</span>
          <span className="text-slate-500 text-[11px]">{env.apiUrl}</span>
        </div>
      )}

      {/* Hero Action Card (White Theme with Crisp Border) */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
              SOLANA DEVNET
            </span>
            <span className="text-xs font-mono text-slate-500">
              Quorum: 2/3 Registered Verifier Consensus
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Decentralized Verifiable Compute Console
          </h2>
          <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
            Every computation executes deterministically in isolated WASM runtimes. Receipts are signed on-chain with Ed25519; challenges trigger stake slashing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/rulesets"
            className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition shadow-xs"
          >
            Browse Rule Sets
          </Link>
          <Link
            href="/create-job"
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white transition shadow-sm shadow-blue-500/20 flex items-center gap-1.5"
          >
            <Zap className="w-3.5 h-3.5" /> Dispatch Job
          </Link>
        </div>
      </div>

      {/* Top 4 Metrics Cards (Crisp White Theme) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              className={`rounded-2xl p-5 bg-gradient-to-br ${item.color} border ${item.border} shadow-xs hover:border-blue-300 transition-all duration-200 flex flex-col justify-between`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-500">
                  {item.title}
                </span>
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${item.iconBg}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-4">
                <div className={`text-3xl font-extrabold tracking-tight font-mono ${item.textAccent}`}>
                  {item.value}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 font-mono">
                  {item.change}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Task Throughput Chart Card (White Theme Recharts) */}
      <div className="rounded-2xl border border-slate-200/90 bg-white shadow-xs p-6">
        <div className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900 tracking-tight">
                  Execution & Verification Throughput
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Jobs created vs finalized through registered verifier consensus over the last 8 weeks
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Activity className="w-3.5 h-3.5" /> {online ? 'Live Devnet Sync' : statsLoading ? 'Syncing…' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* Recharts Area Chart */}
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={throughputData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="completedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="openedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'monospace' }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'monospace' }}
                domain={[0, throughputTicks[4]]}
                ticks={throughputTicks}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const row = payload[0]?.payload as { name: string; opened: number; completed: number } | undefined;
                    return (
                      <div className="bg-white border border-slate-200 text-slate-800 rounded-xl px-3.5 py-2.5 text-xs shadow-lg font-mono space-y-1">
                        <div className="font-bold text-slate-900">Period: {row?.name}</div>
                        <div className="flex items-center gap-2 text-blue-600">
                          <span className="w-2 h-2 rounded-full bg-blue-600 inline-block"></span>
                          <span>Verified: {row?.completed ?? 0}</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-500">
                          <span className="w-2 h-2 rounded-full bg-slate-400 inline-block"></span>
                          <span>Opened: {row?.opened ?? 0}</span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area
                type="monotone"
                dataKey="completed"
                stroke="#2563eb"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#completedGradient)"
              />
              <Area
                type="monotone"
                dataKey="opened"
                stroke="#94a3b8"
                strokeWidth={2}
                strokeDasharray="4 4"
                fillOpacity={1}
                fill="url(#openedGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-slate-100 text-xs font-mono text-slate-600">
          <div className="flex items-center gap-2">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-slate-400 inline-block"></span>
            <span>Requested</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>
            <span className="text-slate-900 font-semibold">Verified on Solana</span>
          </div>
        </div>
      </div>

      {/* Second Row: Bar Chart & Network Integrity */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Daily Jobs Distribution */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200/90 bg-white shadow-xs p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-600" /> Daily Jobs Created
              </h3>
              <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                Last 7 Days
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Computation requests dispatched per day
            </p>
          </div>

          <div className="h-[190px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#f8fafc" strokeDasharray="2 2" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'monospace' }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'monospace' }} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-white border border-slate-200 text-slate-800 rounded-lg px-2.5 py-1 text-xs font-mono shadow-md">
                          {payload[0]?.value} Jobs Created
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Verity Node Status / Network Summary */}
        <div className="lg:col-span-3 rounded-2xl border border-slate-200/90 bg-white shadow-xs p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" /> Network Consensus & Staking
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-mono font-semibold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5" />{' '}
                {online ? `${fmtNum(stats?.audit_events)} Audit Logs Anchored` : statsLoading ? 'Querying…' : 'Offline'}
              </div>
            </div>

            <div className="space-y-3 font-mono">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-600">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Staked Dispute Engine</div>
                    <div className="text-[11px] text-slate-500">
                      {stats
                        ? `${fmtNum(stats.disputes_by_status?.Open ?? 0)} open · ${fmtNum(stats.disputes_caught)} fraudulent receipts slashed`
                        : loadingLine}
                    </div>
                  </div>
                </div>
                <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded">
                  {stats ? ((stats.disputes_by_status?.Open ?? 0) > 0 ? 'Dispute Open' : 'Quorum 2/3 Active') : '—'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 border border-purple-200 flex items-center justify-center text-purple-600">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800">Registered Verifier Pool</div>
                    <div className="text-[11px] text-slate-500">
                      {stats
                        ? `${fmtNum(stats.providers)} provider · 3 autonomous verifiers · ${fmtNum(stats.programs)} rule sets`
                        : env.apiUrl}
                    </div>
                  </div>
                </div>
                <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded">
                  {online ? 'Online (Devnet)' : 'Offline'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-mono text-slate-500">
            <span className="truncate max-w-[340px]">
              {lastEvent ? (
                <>
                  Latest audit:{' '}
                  {lastEventHref ? (
                    <a href={lastEventHref} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                      {lastEvent.event_type} {lastEvent.request_pda ? `(${shortKey(lastEvent.request_pda, 4)})` : ''}
                    </a>
                  ) : (
                    <span className="text-slate-700">{lastEvent.event_type}</span>
                  )}{' '}
                  · {timeAgo(lastEvent.created_at, now)}
                </>
              ) : (
                'Latest audit: —'
              )}
            </span>
            <Link href="/create-job" className="text-blue-600 font-bold hover:underline flex items-center gap-1 shrink-0">
              Create Job <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Third Row: Recent Computation Requests Table with Clean White Theme */}
      <div className="rounded-2xl border border-slate-200/90 bg-white shadow-xs p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" /> Recent Computation Requests
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Live on-chain verifiable computation requests, receipts, and verifier attestations
            </p>
          </div>
          <Link
            href="/create-job"
            className="text-xs font-bold text-blue-700 hover:text-blue-800 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 flex items-center gap-1 transition shadow-xs"
          >
            + New Job
          </Link>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs font-mono text-left">
            <thead className="border-b border-slate-200 text-slate-400">
              <tr>
                <th className="py-2.5 px-3">Request PDA</th>
                <th className="py-2.5 px-3">Rule Set</th>
                <th className="py-2.5 px-3">Escrow Bounty</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Consensus</th>
                <th className="py-2.5 px-3 text-right">Audit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {(requests ?? []).slice(0, 10).map((r) => {
                const isVerified = r.status === "Verified";
                const isDisputed = r.status === "Disputed";
                const isAwaiting = r.status === "AwaitingVerification";
                const isRejected = r.status === "Rejected";
                return (
                  <tr key={r.request_pda} className="hover:bg-slate-50 transition">
                    <td className="py-3 px-3 font-mono font-semibold text-slate-900">
                      <Link href={`/requests/${r.request_pda}`} className="text-blue-600 hover:underline">
                        {shortKey(r.request_pda, 6)}
                      </Link>
                    </td>
                    <td className="py-3 px-3 text-slate-700 font-medium">
                      {r.title || shortKey(r.program_hash, 6)}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-900 font-bold">
                      {r.bounty_lamports ? `${(r.bounty_lamports / 1e9).toFixed(3)} SOL` : "—"}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono border ${
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
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-600">
                      <span className="text-emerald-700 font-bold">{r.attest_count_match} match</span> / {r.attest_count_mismatch} mismatch
                    </td>
                    <td className="py-3 px-3 text-right">
                      <Link
                        href={`/requests/${r.request_pda}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        Details <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
