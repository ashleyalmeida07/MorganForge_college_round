"use client";

import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

import type { RequestDetail } from "./types";

type StepState = "done" | "current" | "todo" | "failed" | "skipped";
interface Step {
  label: string;
  sub?: string;
  state: StepState;
}

const RANK: Record<string, number> = { Open: 0, Claimed: 1, AwaitingVerification: 2, Disputed: 3, Verified: 4, Rejected: 4, Expired: 4 };

function buildSteps(d: RequestDetail): Step[] {
  const status = d.status ?? "Open";
  const rank = RANK[status] ?? 0;
  const hasReceipt = !!(d.chain_receipt || d.receipt);
  const claimed = hasReceipt || !!(d.chain?.provider || d.request?.provider_pubkey) || rank >= 1;
  const disputed = status === "Disputed" || !!d.dispute || !!d.chain_dispute;
  const att = d.chain?.attest_count_total ?? d.request?.attest_count_total ?? d.attestations.length;
  const required = d.challenge?.required_attestations ?? null;
  const expired = status === "Expired";
  const final = status === "Verified" || status === "Rejected" || expired;
  const pend = (reached: boolean, current: boolean): StepState => (reached ? "done" : current ? "current" : expired ? "skipped" : "todo");

  const steps: Step[] = [
    { label: "Created", state: "done", sub: d.chain?.created_at ? new Date(d.chain.created_at * 1000).toLocaleTimeString() : undefined },
    { label: "Claimed", state: pend(claimed, status === "Open") },
    { label: "Receipt", state: pend(hasReceipt, status === "Claimed") },
    {
      label: "Attestations",
      sub: `${att}/${required ?? "?"}`,
      state: pend(final && !expired ? true : required !== null && att >= required, status === "AwaitingVerification"),
    },
  ];
  if (disputed) steps.push({ label: "Disputed", state: status === "Disputed" ? "current" : "done" });
  steps.push({
    label: final ? status : "Verified",
    state: status === "Verified" ? "done" : status === "Rejected" || expired ? "failed" : "todo",
  });
  return steps;
}

export function StatusStepper({ detail }: { detail: RequestDetail }) {
  const steps = buildSteps(detail);
  return (
    <ol className="flex flex-wrap items-center gap-y-3" aria-label="Request lifecycle">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center" aria-current={s.state === "current" ? "step" : undefined}>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
                s.state === "done" && "border-emerald-500 bg-emerald-500 text-white",
                s.state === "current" && "animate-pulse border-blue-500 bg-blue-50 text-blue-700",
                s.state === "failed" && "border-red-500 bg-red-500 text-white",
                (s.state === "todo" || s.state === "skipped") && "border-slate-200 bg-white text-slate-400",
              )}
            >
              {s.state === "done" ? <Check className="h-4 w-4" aria-hidden /> : s.state === "failed" ? <X className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
            <div className="leading-tight">
              <div
                className={cn(
                  "text-sm font-medium",
                  s.state === "todo" || s.state === "skipped" ? "text-slate-400" : s.state === "failed" ? "text-red-700" : "text-slate-800",
                  s.state === "skipped" && "line-through",
                )}
              >
                {s.label}
              </div>
              {s.sub && <div className="text-[11px] text-slate-500">{s.sub}</div>}
            </div>
          </div>
          {i < steps.length - 1 && (
            <span className={cn("mx-3 h-0.5 w-6 sm:w-10", s.state === "done" ? "bg-emerald-400" : "bg-slate-200")} aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}
