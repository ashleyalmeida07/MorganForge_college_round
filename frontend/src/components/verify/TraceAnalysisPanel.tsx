"use client";

import { useState } from "react";
import { GitBranch, Loader2, Server } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiGet, apiPost } from "@/lib/api";

import { DivergenceCompare } from "./TraceSteps";
import type { ReverifyReport, TraceReport } from "./types";
import { errorMessage, Panel, Pill, shortHash } from "./ui";

function Verdict({ v, yes, no }: { v: boolean | null | undefined; yes: string; no: string }) {
  if (v === true) return <Pill tone="green">{yes}</Pill>;
  if (v === false) return <Pill tone="red">{no}</Pill>;
  return <Pill tone="slate">n/a</Pill>;
}

/** Server-side trace analysis (/trace) and independent re-execution (/reverify). */
export function TraceAnalysisPanel({ pda, hasReceipt }: { pda: string; hasReceipt: boolean }) {
  const [trace, setTrace] = useState<TraceReport | null>(null);
  const [rev, setRev] = useState<ReverifyReport | null>(null);
  const [busy, setBusy] = useState<"trace" | "rev" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "trace" | "rev") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "trace") setTrace(await apiGet<TraceReport>(`/requests/${pda}/trace`));
      else setRev(await apiPost<ReverifyReport>(`/requests/${pda}/reverify`));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const div = trace?.first_divergence;
  return (
    <Panel
      title="Trace analysis (server)"
      icon={<Server className="h-4 w-4 text-slate-500" aria-hidden />}
      description="Ask the Verity backend to check the provider's published TRACE_V2 document and re-execute independently. A second opinion — your browser check above needs no trust at all."
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => run("trace")} disabled={!!busy || !hasReceipt}>
            {busy === "trace" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitBranch className="mr-2 h-4 w-4" />}
            Analyze trace
          </Button>
          <Button variant="outline" size="sm" onClick={() => run("rev")} disabled={!!busy}>
            {busy === "rev" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Re-execute on server
          </Button>
        </>
      }
    >
      {!hasReceipt && !trace && !rev && <p className="text-sm text-slate-500">Trace analysis is available once a receipt is submitted.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {trace && (
        <div className="space-y-3">
          {trace.error && <p className="text-sm text-amber-700">{trace.error}</p>}
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <dt className="text-xs text-slate-500">Published trace vs chain</dt>
              <dd className="mt-1">
                <Verdict v={trace.published_matches_chain} yes="matches trace_root" no="does not match" />
              </dd>
              <dd className="mt-1 text-[11px] text-slate-400">
                {trace.published?.leaf_count ?? trace.published?.steps?.length ?? 0} leaves
                {trace.published_check?.errors?.length ? ` · ${trace.published_check.errors.join("; ")}` : ""}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <dt className="text-xs text-slate-500">Independent re-run vs chain</dt>
              <dd className="mt-1">
                <Verdict v={trace.recomputed_matches_chain} yes="matches trace_root" no="does not match" />
              </dd>
              <dd className="mt-1 font-mono text-[11px] text-slate-400">{shortHash(trace.recomputed?.trace_root)}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <dt className="text-xs text-slate-500">On-chain trace_root</dt>
              <dd className="mt-1 font-mono text-xs text-slate-700">{shortHash(trace.onchain_trace_root)}</dd>
            </div>
          </dl>
          {div ? (
            <>
              <DivergenceCompare
                index={div.index}
                of={div.of}
                label={div.label}
                provider={div.provider_step}
                mine={div.independent_step}
                mineLabel="Independent re-execution"
              />
              {div.independent_proof && (
                <p className="text-xs text-slate-500">
                  Merkle inclusion proof for the honest step: {div.independent_proof.length} sibling hashes (verifiable against the
                  recomputed root).
                </p>
              )}
            </>
          ) : (
            trace.recomputed && <p className="text-sm text-emerald-700">No divergence: every step of the published trace matches.</p>
          )}
        </div>
      )}

      {rev && (
        <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">Server re-execution:</span>
            <Verdict v={rev.error ? false : rev.output_hash ? rev.matches : null} yes="output matches receipt" no={rev.error ? "failed" : "output differs"} />
            <Verdict v={rev.trace_matches} yes="trace matches" no="trace differs" />
            <Verdict v={rev.fuel_matches} yes="fuel matches" no="fuel differs" />
          </div>
          {rev.error && <p className="mt-1 text-xs text-red-600">{rev.error}</p>}
          {rev.verifier_agreement && rev.verifier_agreement.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {rev.verifier_agreement.filter((v) => v.agrees_with_server).length}/{rev.verifier_agreement.length} verifiers agree with the
              server&apos;s output.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
