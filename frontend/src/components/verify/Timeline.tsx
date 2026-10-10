"use client";

import { shortKey } from "@/lib/solana";

import type { TimelineItem } from "./types";
import { ExtLink, fmtTime, shortHash } from "./ui";

const TONE: Record<string, string> = {
  RequestCreated: "bg-slate-400",
  RequestClaimed: "bg-blue-500",
  ReceiptSubmitted: "bg-blue-600",
  Attested: "bg-emerald-500",
  DisputeOpened: "bg-orange-500",
  DisputeResolved: "bg-orange-600",
  Finalized: "bg-emerald-600",
  Rejected: "bg-red-600",
};

function fmtValue(v: unknown): string {
  if (typeof v === "string") return /^[0-9a-f]{40,}$/i.test(v) ? shortHash(v) : v.length > 44 ? shortKey(v, 6) : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return "—";
  return "{…}";
}

function highlights(payload: unknown): [string, string][] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => [k, fmtValue(v)]);
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="text-sm text-slate-500">No events recorded yet.</p>;
  return (
    <ol className="relative ml-2 border-l border-slate-200">
      {items.map((it, i) => (
        <li key={`${it.event_type}-${it.tx_sig ?? i}-${i}`} className="relative pb-5 pl-6 last:pb-0">
          <span
            className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${TONE[it.event_type] ?? "bg-slate-300"}`}
            aria-hidden
          />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold text-slate-900">{it.event_type}</span>
            <time className="text-xs text-slate-500">{fmtTime(it.at)}</time>
            {it.actor && <span className="font-mono text-xs text-slate-500">by {shortKey(it.actor)}</span>}
            {it.explorer && (
              <ExtLink href={it.explorer} className="text-xs">
                tx
              </ExtLink>
            )}
            {it.source === "db" && <span className="text-[11px] text-slate-400">(indexed)</span>}
          </div>
          {highlights(it.payload).length > 0 && (
            <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
              {highlights(it.payload).map(([k, v]) => (
                <div key={k} className="flex gap-1">
                  <dt className="text-slate-400">{k}</dt>
                  <dd className="font-mono text-slate-700">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ol>
  );
}
