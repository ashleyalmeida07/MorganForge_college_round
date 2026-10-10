"use client";

import { useState } from "react";
import { CheckCircle2, CircleDashed, Cpu, Loader2, ShieldCheck, ShieldX, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { verifyLocally, type LocalVerifyResult, type VerifyReason } from "@/lib/verify";

import { DivergenceCompare, TraceSteps } from "./TraceSteps";
import { commitmentsOf, type RequestDetail } from "./types";
import { JsonBlock, Panel } from "./ui";

const REASON_TEXT: Record<VerifyReason, string> = {
  PROGRAM_TAMPERED: "The WASM served from storage does not hash to the program_hash committed on Solana.",
  INPUT_TAMPERED: "The input served from storage does not hash to the input_hash committed on Solana.",
  OUTPUT_MISMATCH: "Re-executing the program produced a different output than the provider's signed receipt.",
  TRACE_MISMATCH: "The output matches, but the execution trace root differs from the receipt's trace_root.",
  EXECUTION_FAILED: "The WASM could not be executed in this browser.",
  FETCH_FAILED: "Could not download the program or input from storage.",
};

function CheckRow({ name, ok, detail }: { name: string; ok: boolean | null; detail?: string }) {
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      {ok === true ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="pass" />
      ) : ok === false ? (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="fail" />
      ) : (
        <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-label="not checked" />
      )}
      <div className="min-w-0">
        <span className="text-slate-800">{name}</span>
        {detail && <div className="truncate font-mono text-[11px] text-slate-400" title={detail}>{detail}</div>}
      </div>
    </li>
  );
}

function Verdict({ r }: { r: LocalVerifyResult }) {
  if (r.ok) {
    return (
      <div className="flex items-center gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 text-emerald-800">
        <ShieldCheck className="h-8 w-8 shrink-0 text-emerald-600" aria-hidden />
        <div>
          <p className="text-lg font-bold tracking-tight">VERIFIED IN YOUR BROWSER</p>
          <p className="text-sm">
            Every hash recomputed locally matches Solana{r.elapsedMs !== undefined ? ` · ${r.elapsedMs} ms` : ""}.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-red-800">
      <ShieldX className="h-8 w-8 shrink-0 text-red-600" aria-hidden />
      <div className="min-w-0">
        <p className="text-lg font-bold tracking-tight">VERIFICATION FAILED{r.reason ? ` — ${r.reason.replace(/_/g, " ")}` : ""}</p>
        <p className="text-sm">{r.reason ? REASON_TEXT[r.reason] : "Unexpected result."}</p>
        {r.error && <p className="mt-1 break-words font-mono text-xs">{r.error}</p>}
      </div>
    </div>
  );
}

/** "Verify in my browser": re-executes the committed WASM locally and compares against the chain. */
export function BrowserVerifyPanel({
  detail,
  onResult,
}: {
  detail: RequestDetail;
  onResult?: (r: LocalVerifyResult) => void;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LocalVerifyResult | null>(null);

  const c = commitmentsOf(detail);
  const a = detail.artifacts;
  const missing = !a?.wasm.url || !a?.input.url ? "Program or input storage URL is unavailable." : !c.programHash || !c.inputHash ? "On-chain commitments are unavailable." : null;

  const run = async () => {
    if (missing || !a.wasm.url || !a.input.url || !c.programHash || !c.inputHash) return;
    setRunning(true);
    try {
      const r = await verifyLocally(
        { wasm: a.wasm.url, input: a.input.url, output: a.output.url ?? null, trace: a.trace.url ?? null },
        { programHash: c.programHash, inputHash: c.inputHash, outputHash: c.outputHash, traceRoot: c.traceRoot },
      );
      setResult(r);
      onResult?.(r);
    } catch (e) {
      const r: LocalVerifyResult = {
        ok: false,
        reason: "EXECUTION_FAILED",
        checks: [],
        error: e instanceof Error ? e.message : String(e),
      };
      setResult(r);
      onResult?.(r);
    } finally {
      setRunning(false);
    }
  };

  const div = result?.divergence;
  return (
    <Panel
      id="verify"
      title="Verify in my browser"
      icon={<Cpu className="h-4 w-4 text-blue-600" aria-hidden />}
      description={
        <>
          No backend trust: the WASM and input are fetched from content-addressed storage, re-hashed against the commitments on
          Solana, and executed right here. Your browser recomputes the output hash and the TRACE_V2 trace root itself.
        </>
      }
      className="border-blue-200 ring-1 ring-blue-100"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={run}
          disabled={running || !!missing}
          className="h-auto rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          {running ? "Re-executing…" : result ? "Run again" : "Verify in my browser"}
        </Button>
        {missing && <p className="text-sm text-amber-700">{missing}</p>}
        {!missing && !c.outputHash && (
          <p className="text-xs text-slate-500">No receipt yet — this will check program + input integrity and preview the output.</p>
        )}
      </div>

      {result && (
        <div className="mt-5 space-y-4" aria-live="polite">
          <Verdict r={result} />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">Checks</h3>
              <ul className="mt-1 divide-y divide-slate-100">
                {result.checks.map((ch) => (
                  <CheckRow key={ch.name} {...ch} />
                ))}
                {result.publishedTrace && (
                  <CheckRow
                    name="Provider's published trace is self-consistent and matches chain"
                    ok={result.publishedTrace.ok && result.publishedTrace.matchesChain !== false}
                    detail={result.publishedTrace.errors.join("; ") || result.publishedTrace.traceRoot || undefined}
                  />
                )}
              </ul>
              {result.elapsedMs !== undefined && <p className="mt-2 text-xs text-slate-400">Completed in {result.elapsedMs} ms</p>}
            </div>
            <div className="min-w-0 rounded-xl border border-slate-200 p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Output computed in your browser</h3>
              {result.output !== undefined ? <JsonBlock value={result.output} maxHeight="max-h-60" /> : <p className="text-sm text-slate-500">No output.</p>}
            </div>
          </div>

          {div && (
            <DivergenceCompare index={div.index} of={div.of} label={div.label} provider={div.provider} mine={div.mine} />
          )}
          {result.trace && <TraceSteps steps={result.trace.steps} divergenceIndex={div?.index ?? null} defaultOpen={!!div} />}
        </div>
      )}
    </Panel>
  );
}
