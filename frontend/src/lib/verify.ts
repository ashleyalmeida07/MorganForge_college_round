// "Verify in my browser": re-execute the rule-set WASM locally and compare hashes with the chain.
import { sha256Hex } from "@/lib/hash";

export interface LocalVerifyResult {
  ok: boolean;
  reason?: "PROGRAM_TAMPERED" | "INPUT_TAMPERED" | "OUTPUT_MISMATCH" | "EXECUTION_FAILED";
  myHash?: string;
  output?: unknown;
  error?: string;
}

export async function verifyLocally(
  wasmUrl: string,
  inputUrl: string,
  chain: { programHash: string; inputHash: string; outputHash: string },
): Promise<LocalVerifyResult> {
  const wasm = new Uint8Array(await (await fetch(wasmUrl, { cache: "no-store" })).arrayBuffer());
  const inputBytes = new Uint8Array(await (await fetch(inputUrl, { cache: "no-store" })).arrayBuffer());

  if ((await sha256Hex(wasm)) !== chain.programHash) return { ok: false, reason: "PROGRAM_TAMPERED" };
  if ((await sha256Hex(inputBytes)) !== chain.inputHash) return { ok: false, reason: "INPUT_TAMPERED" };

  try {
    // No imports -> fully deterministic, same as the backend's wasmtime sandbox.
    const { instance } = await WebAssembly.instantiate(wasm, {});
    const { memory, alloc, compute } = instance.exports as unknown as {
      memory: WebAssembly.Memory;
      alloc: (len: number) => number;
      compute: (ptr: number, len: number) => number;
    };
    const ptr = alloc(inputBytes.length);
    new Uint8Array(memory.buffer).set(inputBytes, ptr);
    const outPtr = compute(ptr, inputBytes.length);
    const len = new DataView(memory.buffer).getUint32(outPtr, true);
    const out = new Uint8Array(memory.buffer.slice(outPtr + 4, outPtr + 4 + len));
    const myHash = await sha256Hex(out);
    return {
      ok: myHash === chain.outputHash,
      reason: myHash === chain.outputHash ? undefined : "OUTPUT_MISMATCH",
      myHash,
      output: JSON.parse(new TextDecoder().decode(out)),
    };
  } catch (e) {
    return { ok: false, reason: "EXECUTION_FAILED", error: e instanceof Error ? e.message : String(e) };
  }
}
