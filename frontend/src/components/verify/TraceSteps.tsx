"use client";

import { ChevronRight, GitCompareArrows } from "lucide-react";

import type { TraceStep } from "@/lib/trace";
import { cn } from "@/lib/utils";

import { shortHash } from "./ui";

function stepBody(s?: TraceStep | null): string {
  if (!s) return "(no step)";
  if (s.state !== undefined) return JSON.stringify(s.state, null, 2);
  if (s.data !== undefined) return s.data;
  return s.kind === "input" ? "(input bytes — committed by input_hash)" : s.kind === "output" ? "(output bytes — committed by output_hash)" : "—";
}

const stepTitle = (s?: TraceStep | null) => (s ? s.label || s.kind : "—");

/** Collapsible list of TRACE_V2 steps; marks the agreed prefix and the first divergent step. */
export function TraceSteps({
  steps,
  divergenceIndex,
  title,
  defaultOpen = false,
}: {
  steps: TraceStep[];
  divergenceIndex?: number | null;
  title?: string;
  defaultOpen?: boolean;
}) {
  const hasDiv = divergenceIndex !== null && divergenceIndex !== undefined;
  return (
    <details open={defaultOpen} className="group rounded-xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
        <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" aria-hidden />
        {title ?? `Execution trace (${steps.length} steps)`}
      </summary>
      <ol className="max-h-[28rem] divide-y divide-slate-100 overflow-auto border-t border-slate-100">
        {steps.map((s) => {
          const diverged = hasDiv && s.index === divergenceIndex;
          const agreed = hasDiv && s.index < (divergenceIndex as number);
          return (
            <li key={s.index} className={cn("px-4 py-2.5 text-xs", diverged && "bg-red-50")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-8 shrink-0 font-mono text-slate-400">#{s.index}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-medium",
                    s.kind === "checkpoint" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {s.kind}
                </span>
                {s.label && <span className="font-medium text-slate-800">{s.label}</span>}
                <span className="ml-auto font-mono text-slate-400" title={s.leaf}>
                  leaf {shortHash(s.leaf, 8, 4)}
                </span>
                {agreed && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">agreed</span>}
                {diverged && <span className="rounded bg-red-600 px-1.5 py-0.5 font-semibold text-white">diverged</span>}
              </div>
              {(s.state !== undefined || s.data !== undefined) && (
                <pre className="mt-1.5 ml-10 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700">
                  {stepBody(s)}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

/** Side-by-side provider vs independent state at the first divergent step. */
export function DivergenceCompare({
  index,
  of,
  label,
  provider,
  mine,
  mineLabel = "Your browser",
}: {
  index: number;
  of: number;
  label?: string | null;
  provider?: TraceStep | null;
  mine?: TraceStep | null;
  mineLabel?: string;
}) {
  return (
    <div className="rounded-xl border-2 border-red-200 bg-red-50/60 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
        <GitCompareArrows className="h-4 w-4" aria-hidden />
        First divergent step: #{index} of {of}
        {label ? ` (${label})` : ""}
      </p>
      <p className="mt-1 text-xs text-red-700">
        Steps #0–#{Math.max(0, index - 1)} agree{index === 0 ? " (none)" : ""}; the provider&apos;s trace departs from an honest
        re-execution here.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {[
          { who: "Provider (published)", step: provider },
          { who: mineLabel, step: mine },
        ].map(({ who, step }) => (
          <div key={who} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-800">{who}</span>
              <span className="font-mono text-slate-400" title={step?.leaf}>
                {stepTitle(step)} · {shortHash(step?.leaf, 6, 4)}
              </span>
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-slate-700">{stepBody(step)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
