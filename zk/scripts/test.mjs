// Prove + verify the payroll circuit off-chain, check soundness on a bad witness, and
// write a fixture consumed by the on-chain verifier's native Rust test
// (programs/verity_core/programs/verity_zk_verifier/tests/fixture.json).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

import { payrollInputJson, payrollOutputJson, proofToSolana, requestHalves, sha256hex } from "./lib.mjs";

const ZK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(ZK, "..");
const WASM = join(ZK, "build", "payroll_js", "payroll.wasm");
const ZKEY = join(ZK, "build", "payroll_final.zkey");
const VK = JSON.parse((await import("node:fs")).readFileSync(join(ZK, "build", "verification_key.json"), "utf8"));

const PDA = "9uqynWB5rqeaqNsySnSLpxjL2Pgmet6Lqb4pSHCjmDqi"; // any 32-byte key works for the fixture
const input = { salary_cents: 1000000, tax_bps: 2000, deductions_cents: 50000 };
const [hi, lo] = requestHalves(PDA);

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  { ...input, request_hi: hi, request_lo: lo }, WASM, ZKEY,
);
console.log(`proved in ${Date.now() - t0} ms; public = ${JSON.stringify(publicSignals)}`);
const [tax, net] = publicSignals;
check("tax = 200000, net = 750000", tax === "200000" && net === "750000");
check("snarkjs verify", await snarkjs.groth16.verify(VK, publicSignals, proof));

const forged = [...publicSignals];
forged[1] = String(BigInt(net) + 100000n); // claim inflated net pay
check("forged output rejected", !(await snarkjs.groth16.verify(VK, forged, proof)));
const replay = [...publicSignals];
replay[5] = "1";
check("proof bound to request PDA", !(await snarkjs.groth16.verify(VK, replay, proof)));

let threw = false;
try {
  await snarkjs.groth16.fullProve({ salary_cents: 100, tax_bps: 2000, deductions_cents: 500, request_hi: hi, request_lo: lo }, WASM, ZKEY);
} catch {
  threw = true;
}
check("negative net pay cannot be proven", threw);

const s = proofToSolana(proof);
const fixture = {
  request_pda: PDA,
  input,
  input_json: payrollInputJson(input),
  input_hash: sha256hex(payrollInputJson(input)),
  output_json: payrollOutputJson(input, tax, net),
  output_hash: sha256hex(payrollOutputJson(input, tax, net)),
  tax_cents: Number(tax),
  net_cents: Number(net),
  public_signals: publicSignals,
  proof_a: [...s.a],
  proof_b: [...s.b],
  proof_c: [...s.c],
};
const out = join(ROOT, "programs", "verity_core", "programs", "verity_zk_verifier", "tests", "fixture.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(fixture, null, 2));
console.log(`wrote ${out}`);
console.log(failures ? `${failures} FAILED` : "all zk checks passed");
process.exit(failures ? 1 : 0);
