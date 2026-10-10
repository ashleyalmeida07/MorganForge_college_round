"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import type { RequestStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

export const normHex = (h?: string | null) => (h ?? "").toLowerCase().replace(/^0x/, "");
export const shortHash = (h?: string | null, head = 8, tail = 6) => {
  const s = normHex(h);
  if (!s) return "—";
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
};

export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|reject|denied|cancel/i.test(msg)) return "Transaction was rejected in the wallet.";
  return msg || "Something went wrong.";
}

export function fmtTime(v?: string | number | null): string {
  if (v === null || v === undefined || v === "" || v === 0) return "—";
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function fmtDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}h ${m}m ${r}s` : m ? `${m}m ${r}s` : `${r}s`;
}

export function useCopy(timeout = 1500) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), timeout);
      } catch {
        setCopied(false);
      }
    },
    [timeout],
  );
  return { copied, copy };
}

/** A hash/key that can be expanded in place and copied. */
export function HashValue({ value, label, className }: { value?: string | null; label?: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const { copied, copy } = useCopy();
  if (!value) return <span className="font-mono text-xs text-slate-400">—</span>;
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-start gap-1", className)}>
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        title={expanded ? "Collapse" : "Show full value"}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${label ?? "value"}`}
        className={cn(
          "min-w-0 rounded px-1 py-0.5 text-left font-mono text-xs text-slate-700 hover:bg-slate-100",
          expanded ? "break-all" : "truncate",
        )}
      >
        {expanded ? value : shortHash(value)}
      </button>
      <button
        type="button"
        onClick={() => copy(value)}
        aria-label={`Copy ${label ?? "value"}`}
        title="Copy"
        className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

export function ExtLink({ href, children, className }: { href?: string | null; children: React.ReactNode; className?: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex items-center gap-1 text-blue-600 hover:underline", className)}
    >
      {children}
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
    </a>
  );
}

export function Panel({
  title,
  description,
  icon,
  actions,
  children,
  className,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            {icon}
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

const STATUS_STYLE: Record<RequestStatus, string> = {
  Open: "bg-slate-100 text-slate-700 border-slate-200",
  Claimed: "bg-blue-50 text-blue-700 border-blue-200",
  AwaitingVerification: "bg-amber-50 text-amber-700 border-amber-200",
  Disputed: "bg-orange-50 text-orange-700 border-orange-200",
  Verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Rejected: "bg-red-50 text-red-700 border-red-200",
  Expired: "bg-slate-100 text-slate-500 border-slate-200",
};

export const statusLabel = (s?: string | null) => (s === "AwaitingVerification" ? "Awaiting verification" : s ?? "Unknown");

export function StatusBadge({ status, size = "md" }: { status?: RequestStatus | null; size?: "md" | "lg" }) {
  const style = (status && STATUS_STYLE[status]) || "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold",
        size === "lg" ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-0.5 text-xs",
        style,
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

export function Pill({ tone, children }: { tone: "green" | "red" | "amber" | "slate" | "blue"; children: React.ReactNode }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
  } as const;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function JsonBlock({ value, maxHeight = "max-h-80" }: { value: unknown; maxHeight?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className={cn("overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800", maxHeight)}>
      {text}
    </pre>
  );
}

/** Fetch a JSON (or text) blob from a public URL; returns parsed JSON when possible. */
export function useFetchJson(url?: string | null) {
  const [data, setData] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!url) {
      setData(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      })
      .then((v) => !cancelled && setData(v))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { data, error, loading };
}

/** Current origin, resolved after mount (avoids SSR/hydration mismatches). */
export function useOrigin() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}
