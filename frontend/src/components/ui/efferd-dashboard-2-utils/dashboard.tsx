"use client";

import React, { useMemo } from 'react';
import {
  FileText,
  ClipboardList,
  Users,
  BarChart3,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  ShieldCheck,
  Activity
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
import { shortKey } from '@/lib/solana';
import { env, explorerAddress, explorerTx } from '@/lib/env';

// Row shape returned by GET /activity (audit_log row + decorate_audit_row links).
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

function timeAgo(s?: string | null) {
  const t = ts(s);
  if (Number.isNaN(t)) return '—';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const d = Math.round(hr / 24);
  return `${d} days ago`;
}

/** Four evenly spaced Y ticks (0..4 steps) that cover `max`. */
function niceTicks(max: number) {
  const step = Math.max(1, Math.ceil(max / 4));
  return [0, step, step * 2, step * 3, step * 4];
}

export function Dashboard() {
  const { data: stats, error: statsError, loading: statsLoading } = useApi<Stats>('/stats', 15000);
  const { data: requests, error: reqError } = useApi<RequestRow[]>('/requests?scope=all&limit=200', 30000);
  const { data: activity, error: actError } = useApi<ActivityRow[]>('/activity?limit=20', 15000);

  const backendError = statsError ?? reqError ?? actError;
  const online = !statsError && !!stats;

  // Task throughput: requests opened (created_at) vs completed (Verified/Rejected at updated_at), last 8 weeks
  const throughputData = useMemo(() => {
    const now = Date.now();
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
  }, [requests]);

  const throughputTicks = useMemo(
    () => niceTicks(Math.max(0, ...throughputData.map((d) => Math.max(d.opened, d.completed)))),
    [throughputData],
  );

  // Daily distribution: requests created per day over the last 7 days (ending today)
  const dailyData = useMemo(() => {
    const today = new Date();
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
  }, [requests]);

  const loadingLine = statsLoading ? 'Loading…' : '—';
  const decided = stats ? stats.verified + stats.rejected : 0;

  const statCards = [
    {
      title: 'Total requests',
      value: fmtNum(stats?.total_requests),
      change: stats
        ? `${fmtNum(stats.by_status?.Open ?? 0)} open · ${fmtNum(stats.verified)} verified`
        : loadingLine,
      icon: FileText,
    },
    {
      title: 'In flight',
      value: fmtNum(stats?.in_flight),
      change: stats
        ? `${fmtNum(stats.by_status?.AwaitingVerification ?? 0)} awaiting · ${fmtNum(stats.by_status?.Disputed ?? 0)} disputed`
        : loadingLine,
      icon: ClipboardList,
    },
    {
      title: 'Disputes caught',
      value: fmtNum(stats?.disputes_caught),
      change: stats
        ? `of ${fmtNum(stats.disputes_total)} disputes · ${fmtNum(stats.frivolous_disputes)} frivolous`
        : loadingLine,
      icon: Users,
    },
    {
      title: 'Verified rate',
      value: stats?.verified_pct != null ? `${Math.round(stats.verified_pct)}%` : '—',
      change: stats ? `${fmtNum(stats.verified)} of ${fmtNum(decided)} decided` : loadingLine,
      icon: BarChart3,
    },
  ];

  const lastEvent = activity?.[0];
  const lastEventHref = lastEvent
    ? explorerTx(lastEvent.tx_sig) ?? explorerAddress(lastEvent.request_pda)
    : null;

  return (
    <div className="space-y-6 w-full max-w-[1240px] mx-auto pb-10">

      {backendError && (
        <p className="text-xs text-rose-600">
          Backend unreachable at {env.apiUrl} ({backendError.message}){stats ? ' — showing last known data.' : '.'}
        </p>
      )}

      {/* Top 4 Metrics Cards (Clean White & Blue Style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs hover:border-blue-200 transition-all duration-200 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{item.title}</span>
                <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500">
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-4">
                <div className="text-3xl font-bold tracking-tight text-slate-900">{item.value}</div>
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-1 font-normal">
                  <span>{item.change}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Task Throughput Chart Card (White and Blue) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Request throughput</h2>
              <p className="text-sm text-slate-500 mt-0.5">Requests opened against requests completed over the last eight weeks</p>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                <Activity className="w-3.5 h-3.5" /> {online ? 'Live Sync' : statsLoading ? 'Connecting…' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* Recharts Area Chart */}
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={throughputData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="completedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="0 0" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#64748b' }}
                dy={12}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#64748b' }}
                domain={[0, throughputTicks[4]]}
                ticks={throughputTicks}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const row = payload[0]?.payload as { name: string; opened: number; completed: number } | undefined;
                    return (
                      <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
                        <div className="font-semibold text-slate-300">Week of {row?.name}</div>
                        <div className="flex items-center gap-2 text-blue-400">
                          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
                          <span>Completed: {row?.completed ?? 0}</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-300">
                          <span className="w-2 h-2 rounded-full bg-slate-400 inline-block"></span>
                          <span>Opened: {row?.opened ?? 0}</span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              {/* Completed: Solid Blue Line with smooth blue gradient area */}
              <Area
                type="monotone"
                dataKey="completed"
                stroke="#2563eb"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#completedGradient)"
              />
              {/* Opened: Dashed Comparison Line */}
              <Area
                type="monotone"
                dataKey="opened"
                stroke="#94a3b8"
                strokeWidth={2}
                strokeDasharray="4 4"
                fillOpacity={0}
                fill="none"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend matching reference image */}
        <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-slate-100 text-xs font-medium text-slate-600">
          <div className="flex items-center gap-2">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-slate-400 inline-block"></span>
            <span>Opened</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-xs bg-blue-600 inline-block"></span>
            <span className="text-slate-900 font-semibold">Completed</span>
          </div>
        </div>
      </div>

      {/* Second Row: Bar Chart & System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Daily Jobs Distribution */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Daily requests</h3>
              <span className="text-xs text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full">Last 7 days</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Computation requests created per day</p>
          </div>

          <div className="h-[200px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#f8fafc" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-slate-900 text-white rounded-md px-2.5 py-1.5 text-xs">
                          {payload[0]?.value} created
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} barSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Verity Node Status / Network Summary */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">Network Integrity</h3>
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                <CheckCircle2 className="w-3.5 h-3.5" />{' '}
                {online ? `${fmtNum(stats?.audit_events)} audit events` : statsLoading ? 'Checking…' : 'Unreachable'}
              </div>
            </div>

            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Bisection Dispute Engine</div>
                    <div className="text-[11px] text-slate-500">
                      {stats
                        ? `${fmtNum(stats.disputes_by_status?.Open ?? 0)} open · ${fmtNum(stats.disputes_caught)} caught · ${fmtNum(stats.attestations)} attestations`
                        : loadingLine}
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded">
                  {stats ? ((stats.disputes_by_status?.Open ?? 0) > 0 ? 'Active' : 'Ready') : '—'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Verity Backend</div>
                    <div className="text-[11px] text-slate-500">
                      {stats
                        ? `${env.cluster} · ${fmtNum(stats.providers)} providers · ${fmtNum(stats.programs)} programs`
                        : env.apiUrl}
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                  {online ? 'Online' : statsLoading ? '—' : 'Offline'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              {lastEvent ? (
                <>
                  Last audit event:{' '}
                  {lastEventHref ? (
                    <a href={lastEventHref} target="_blank" rel="noreferrer" className="hover:underline">
                      {lastEvent.event_type}
                      {lastEvent.request_pda ? ` · ${shortKey(lastEvent.request_pda)}` : ''}
                    </a>
                  ) : (
                    <>
                      {lastEvent.event_type}
                      {lastEvent.request_pda ? ` · ${shortKey(lastEvent.request_pda)}` : ''}
                    </>
                  )}{' '}
                  · {timeAgo(lastEvent.created_at)}
                </>
              ) : activity ? (
                'No audit events yet'
              ) : (
                'Last audit event: —'
              )}
            </span>
            <a href="/create-job" className="text-blue-600 font-semibold hover:underline flex items-center gap-1">
              Create New Job <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

      </div>

    </div>
  );
}

export default Dashboard;
