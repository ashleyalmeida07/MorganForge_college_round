// V8 side of the determinism check (run by rulesets/build_all.sh after determinism.py).
// Re-executes every case with the exact calls of frontend/src/lib/verify.ts executeWasm()
// (WebAssembly.instantiate with no imports, alloc -> write -> compute -> read [u32 len][bytes],
// optional trace()) and requires byte-identical output and trace checkpoints to wasmtime.
//
// Usage: node rulesets/scripts/determinism.mjs <results.json>
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RULESETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function splitCheckpoints(ndjson) {
  // identical to frontend/src/lib/trace.ts splitCheckpoints
  const out = [];
  let start = 0;
  for (let i = 0; i <= ndjson.length; i++) {
    if (i === ndjson.length || ndjson[i] === 0x0a) {
      if (i > start) out.push(ndjson.slice(start, i));
      start = i + 1;
    }
  }
  return out;
}

function checkpointsDigest(cps) {
  const h = crypto.createHash("sha256");
  for (const c of cps) {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(c.length);
    h.update(len).update(c);
  }
  return h.digest("hex");
}

async function execute(module, input) {
  // fresh instance per case, like the browser (one instantiate per verification)
  const instance = await WebAssembly.instantiate(module, {});
  const ex = instance.exports;
  const ptr = ex.alloc(input.length) >>> 0;
  new Uint8Array(ex.memory.buffer).set(input, ptr);
  const outPtr = ex.compute(ptr, input.length) >>> 0;
  const outLen = new DataView(ex.memory.buffer).getUint32(outPtr, true);
  const output = new Uint8Array(ex.memory.buffer.slice(outPtr + 4, outPtr + 4 + outLen));
  let checkpoints = [];
  if (typeof ex.trace === "function") {
    const tPtr = ex.trace() >>> 0;
    const tLen = new DataView(ex.memory.buffer).getUint32(tPtr, true);
    checkpoints = splitCheckpoints(new Uint8Array(ex.memory.buffer.slice(tPtr + 4, tPtr + 4 + tLen)));
  }
  return { output, checkpoints };
}

let failures = 0;
for (const rs of results) {
  const wasm = fs.readFileSync(path.join(RULESETS, rs.wasm));
  const module = await WebAssembly.compile(wasm);
  const imports = WebAssembly.Module.imports(module);
  if (imports.length) {
    console.log(`FAIL ${rs.ruleset}: has imports ${JSON.stringify(imports)} (rule sets must be import-free)`);
    failures++;
    continue;
  }
  let bad = 0;
  for (const [i, c] of rs.cases.entries()) {
    const input = Buffer.from(c.input_b64, "base64");
    let got;
    try {
      const { output, checkpoints } = await execute(module, input);
      got = { output_sha256: sha(output), checkpoints_sha256: checkpointsDigest(checkpoints) };
    } catch (e) {
      got = { error: String(e?.message ?? e) };
    }
    const same = c.error
      ? Boolean(got.error) // both engines must refuse the input (trap / out-of-range)
      : got.output_sha256 === c.output_sha256 && got.checkpoints_sha256 === c.checkpoints_sha256;
    if (!same) {
      bad++;
      console.log(`FAIL ${rs.ruleset} case ${i} input=${input.toString("utf8").slice(0, 120)}`);
      console.log(`     wasmtime ${JSON.stringify({ out: c.output_sha256, cps: c.checkpoints_sha256, err: c.error })}`);
      console.log(`     v8       ${JSON.stringify({ out: got.output_sha256, cps: got.checkpoints_sha256, err: got.error })}`);
    }
  }
  failures += bad;
  console.log(`${bad ? "FAIL" : "ok  "}  v8 ${rs.ruleset.padEnd(18)} ${rs.cases.length - bad}/${rs.cases.length} cases identical to wasmtime`);
}

console.log(failures ? `\n${failures} determinism failure(s)` : "\nwasmtime and V8 agree on every rule set and case");
process.exitCode = failures ? 1 : 0;
