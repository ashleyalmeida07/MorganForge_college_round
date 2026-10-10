// "Verify in my browser": re-execute the rule-set WASM locally (no backend trust) and compare
// program/input/output hashes and the TRACE_V2 trace root with the on-chain commitments.
import { sha256Hex } from "@/lib/hash";
import { buildTrace, checkTraceDocument, firstDivergence, splitCheckpoints, type LocalTrace, type TraceStep } from "@/lib/trace";

export type VerifyReason =
  | "PROGRAM_TAMPERED"
  | "INPUT_TAMPERED"
  | "OUTPUT_MISMATCH"
  | "TRACE_MISMATCH"
  | "EXECUTION_FAILED"
  | "FETCH_FAILED";

export interface ChainCommitments {
  programHash: string;
  inputHash: string;
  outputHash?: string | null;
  traceRoot?: string | null;
}

export interface Divergence {
  index: number;
  of: number;
  label?: string | null;
  kind?: string;
  provider?: TraceStep;
  mine?: TraceStep;
}

export interface LocalVerifyResult {
  ok: boolean;
  reason?: VerifyReason;
  checks: { name: string; ok: boolean | null; detail?: string }[];
  programHash?: string;
  inputHash?: string;
  myHash?: string;
  output?: unknown;
  outputText?: string;
  trace?: LocalTrace;
  storedOutputMatches?: boolean | null;
  publishedTrace?: { ok: boolean; traceRoot: string | null; matchesChain: boolean | null; errors: string[] } | null;
  divergence?: Divergence | null;
  elapsedMs?: number;
  error?: string;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

interface Exports {
  memory: WebAssembly.Memory;
  alloc: (len: number) => number;
  compute: (ptr: number, len: number) => number;
  trace?: () => number;
}

/** Execute a rule set exactly like the backend's wasmtime sandbox (no imports). */
export async function executeWasm(wasm: Uint8Array, input: Uint8Array) {
  const { instance } = await WebAssembly.instantiate(wasm as BufferSource, {});
  const ex = instance.exports as unknown as Exports;
  const ptr = ex.alloc(input.length) >>> 0;
  new Uint8Array(ex.memory.buffer).set(input, ptr);
  const outPtr = ex.compute(ptr, input.length) >>> 0;
  const outLen = new DataView(ex.memory.buffer).getUint32(outPtr, true);
  const output = new Uint8Array(ex.memory.buffer.slice(outPtr + 4, outPtr + 4 + outLen));
  let checkpoints: Uint8Array[] = [];
  if (typeof ex.trace === "function") {
    const tPtr = ex.trace() >>> 0;
    const tLen = new DataView(ex.memory.buffer).getUint32(tPtr, true);
    checkpoints = splitCheckpoints(new Uint8Array(ex.memory.buffer.slice(tPtr + 4, tPtr + 4 + tLen)));
  }
  return { output, checkpoints };
}

export async function verifyLocally(
  urls: { wasm: string; input: string; output?: string | null; trace?: string | null },
  chain: ChainCommitments,
): Promise<LocalVerifyResult> {
  const t0 = performance.now();
  const checks: LocalVerifyResult["checks"] = [];
  const done = (r: Omit<LocalVerifyResult, "checks" | "elapsedMs">): LocalVerifyResult => ({
    ...r,
    checks,
    elapsedMs: Math.round(performance.now() - t0),
  });

  let wasm: Uint8Array, input: Uint8Array;
  try {
    [wasm, input] = await Promise.all([fetchBytes(urls.wasm), fetchBytes(urls.input)]);
  } catch (e) {
    return done({ ok: false, reason: "FETCH_FAILED", error: e instanceof Error ? e.message : String(e) });
  }

  const programHash = await sha256Hex(wasm);
  const pOk = programHash === chain.programHash.toLowerCase();
  checks.push({ name: "Program hash = chain program_hash", ok: pOk, detail: programHash });
  const inputHash = await sha256Hex(input);
  const iOk = inputHash === chain.inputHash.toLowerCase();
  checks.push({ name: "Input hash = chain input_hash", ok: iOk, detail: inputHash });
  if (!pOk) return done({ ok: false, reason: "PROGRAM_TAMPERED", programHash, inputHash });
  if (!iOk) return done({ ok: false, reason: "INPUT_TAMPERED", programHash, inputHash });

  let output: Uint8Array, checkpoints: Uint8Array[];
  try {
    ({ output, checkpoints } = await executeWasm(wasm, input));
  } catch (e) {
    checks.push({ name: "Execute WASM in this browser", ok: false });
    return done({ ok: false, reason: "EXECUTION_FAILED", programHash, inputHash, error: e instanceof Error ? e.message : String(e) });
  }
  const outputText = new TextDecoder().decode(output);
  let outputObj: unknown = outputText;
  try {
    outputObj = JSON.parse(outputText);
  } catch {
    /* keep text */
  }
  const myHash = await sha256Hex(output);
  const trace = await buildTrace(input, checkpoints, output);
  checks.push({ name: "Executed WASM in this browser", ok: true, detail: `${checkpoints.length} checkpoints` });

  let storedOutputMatches: boolean | null = null;
  if (urls.output) {
    try {
      storedOutputMatches = (await sha256Hex(await fetchBytes(urls.output))) === myHash;
    } catch {
      storedOutputMatches = null;
    }
  }

  // Provider's published trace vs chain vs my own run.
  let publishedTrace: LocalVerifyResult["publishedTrace"] = null;
  let divergence: Divergence | null = null;
  if (urls.trace && chain.traceRoot) {
    try {
      const doc = JSON.parse(new TextDecoder().decode(await fetchBytes(urls.trace))) as { steps?: TraceStep[]; trace_root?: string };
      const chk = await checkTraceDocument(doc);
      publishedTrace = { ...chk, matchesChain: chk.traceRoot ? chk.traceRoot === chain.traceRoot.toLowerCase() : null };
      const theirs = (doc.steps ?? []).map((s) => s.leaf);
      const idx = firstDivergence(theirs, trace.leaves);
      if (idx !== null) {
        const mine = trace.steps[idx];
        const provider = doc.steps?.[idx];
        divergence = {
          index: idx,
          of: Math.max(theirs.length, trace.leaves.length),
          label: mine?.label ?? provider?.label,
          kind: mine?.kind ?? provider?.kind,
          provider,
          mine,
        };
      }
    } catch {
      publishedTrace = null;
    }
  }

  if (!chain.outputHash) {
    return done({ ok: true, programHash, inputHash, myHash, output: outputObj, outputText, trace, storedOutputMatches, publishedTrace, divergence });
  }
  const oOk = myHash === chain.outputHash.toLowerCase();
  checks.push({ name: "My output hash = receipt output_hash", ok: oOk, detail: myHash });
  const tOk = chain.traceRoot ? trace.traceRoot === chain.traceRoot.toLowerCase() : null;
  checks.push({ name: "My trace root = receipt trace_root", ok: tOk, detail: trace.traceRoot });
  if (storedOutputMatches !== null) checks.push({ name: "Stored output blob = my output", ok: storedOutputMatches });
  return done({
    ok: oOk && tOk !== false,
    reason: !oOk ? "OUTPUT_MISMATCH" : tOk === false ? "TRACE_MISMATCH" : undefined,
    programHash,
    inputHash,
    myHash,
    output: outputObj,
    outputText,
    trace,
    storedOutputMatches,
    publishedTrace,
    divergence,
  });
}
