// TRACE_V2 execution-trace Merkle commitments, byte-identical to backend/app/engine/trace.py.
//
//   steps      = [input, checkpoint_1..n (from the rule set's trace() export), output]
//   leaf_i     = sha256("VERITY_TRACE_LEAF_V2" || u32le(i) || sha256(step_i))
//   node       = sha256(0x01 || left || right)   (odd node carried up)
//   trace_root = sha256("VERITY_TRACE_V2" || u32le(leaf_count) || merkle_root)
import { sha256, toHex, utf8 } from "@/lib/hash";

const LEAF_DOMAIN = utf8("VERITY_TRACE_LEAF_V2");
const ROOT_DOMAIN = utf8("VERITY_TRACE_V2");

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

export function splitCheckpoints(ndjson: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i <= ndjson.length; i++) {
    if (i === ndjson.length || ndjson[i] === 0x0a) {
      if (i > start) out.push(ndjson.slice(start, i));
      start = i + 1;
    }
  }
  return out;
}

export async function leafHash(index: number, step: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(LEAF_DOMAIN, u32le(index), await sha256(step)));
}

export async function merkleRoot(leaves: Uint8Array[]): Promise<Uint8Array> {
  if (!leaves.length) throw new Error("empty trace");
  let level = leaves;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) next.push(await sha256(concat(new Uint8Array([1]), level[i], level[i + 1])));
    if (level.length % 2) next.push(level[level.length - 1]);
    level = next;
  }
  return level[0];
}

export async function rootFromLeaves(leaves: Uint8Array[]): Promise<Uint8Array> {
  return sha256(concat(ROOT_DOMAIN, u32le(leaves.length), await merkleRoot(leaves)));
}

export interface TraceStep {
  index: number;
  kind: "input" | "checkpoint" | "output";
  label?: string | null;
  data?: string;
  state?: unknown;
  step_hash: string;
  leaf: string;
}

export interface LocalTrace {
  steps: TraceStep[];
  leaves: string[];
  traceRoot: string;
}

export async function buildTrace(input: Uint8Array, checkpoints: Uint8Array[], output: Uint8Array): Promise<LocalTrace> {
  const raw = [input, ...checkpoints, output];
  const leaves: Uint8Array[] = [];
  const steps: TraceStep[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < raw.length; i++) {
    const leaf = await leafHash(i, raw[i]);
    leaves.push(leaf);
    const kind = i === 0 ? "input" : i === raw.length - 1 ? "output" : "checkpoint";
    const step: TraceStep = { index: i, kind, step_hash: toHex(await sha256(raw[i])), leaf: toHex(leaf) };
    if (kind === "checkpoint") {
      step.data = dec.decode(raw[i]);
      try {
        const obj = JSON.parse(step.data) as { step?: string; state?: unknown };
        step.label = obj.step ?? null;
        step.state = obj.state;
      } catch {
        step.label = null;
      }
    }
    steps.push(step);
  }
  return { steps, leaves: leaves.map(toHex), traceRoot: toHex(await rootFromLeaves(leaves)) };
}

/** Recompute a published trace document's root from its leaves (and leaves from step hashes). */
export async function checkTraceDocument(doc: { steps?: TraceStep[]; trace_root?: string }) {
  const errors: string[] = [];
  const leaves: Uint8Array[] = [];
  for (const [i, s] of (doc.steps ?? []).entries()) {
    const leaf = Uint8Array.from((s.leaf.match(/../g) ?? []).map((h) => parseInt(h, 16)));
    const stepHash = Uint8Array.from((s.step_hash.match(/../g) ?? []).map((h) => parseInt(h, 16)));
    const expect = toHex(await sha256(concat(LEAF_DOMAIN, u32le(i), stepHash)));
    if (expect !== s.leaf) errors.push(`step ${i}: leaf mismatch`);
    if (s.data !== undefined && toHex(await sha256(utf8(s.data))) !== s.step_hash) errors.push(`step ${i}: data mismatch`);
    leaves.push(leaf);
  }
  const root = leaves.length ? toHex(await rootFromLeaves(leaves)) : null;
  if (root && doc.trace_root && root !== doc.trace_root.toLowerCase()) errors.push("root mismatch");
  return { ok: !errors.length && !!root, traceRoot: root, errors };
}

export function firstDivergence(a: string[], b: string[]): number | null {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i].toLowerCase() !== b[i].toLowerCase()) return i;
  return a.length === b.length ? null : n;
}
