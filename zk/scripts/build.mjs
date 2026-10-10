// Compile the payroll circuit, run the Groth16 setup, export the verifying key and
// copy artifacts to where they are consumed:
//   frontend/public/zk/payroll.wasm, payroll_final.zkey, verification_key.json  (browser prover)
//   programs/verity_core/programs/verity_zk_verifier/src/vk.rs                (on-chain verifier)
//
// Phase 1 uses the public Hermez powers-of-tau (2^10) when a mirror is reachable,
// otherwise a local single-contributor ceremony; phase 2 is a single local
// contribution. Fine for a demo; production would use a multi-party ceremony.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBn128 } from "ffjavascript";
import * as snarkjs from "snarkjs";

import { vkToRust } from "./lib.mjs";

const ZK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(ZK, "..");
const BUILD = join(ZK, "build");
const PTAU = join(BUILD, "pot10_final.ptau");
const PTAU_URLS = [
  "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_10.ptau",
  "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_10.ptau",
];

mkdirSync(BUILD, { recursive: true });

const circom = process.platform === "win32" ? join(ZK, "bin", "circom.exe") : "circom";
console.log("compiling circuit ...");
execFileSync(circom, [join(ZK, "payroll", "payroll.circom"), "--r1cs", "--wasm", "--sym", "-o", BUILD], {
  stdio: "inherit",
});

if (!existsSync(PTAU)) {
  for (const url of PTAU_URLS) {
    console.log(`downloading ${url} ...`);
    const res = await fetch(url).catch(() => null);
    if (res?.ok) {
      writeFileSync(PTAU, Buffer.from(await res.arrayBuffer()));
      break;
    }
    console.log(`  unavailable (${res ? `HTTP ${res.status}` : "network error"})`);
  }
}
if (!existsSync(PTAU)) {
  // Public mirrors gone: run a local phase-1 ceremony (power 10 = up to 1024 constraints).
  console.log("running local powers-of-tau (bn128, 2^10) ...");
  const t0 = join(BUILD, "pot10_0000.ptau");
  const t1 = join(BUILD, "pot10_0001.ptau");
  await snarkjs.powersOfTau.newAccumulator(await buildBn128(), 10, t0);
  await snarkjs.powersOfTau.contribute(t0, t1, "verity-phase1", randomBytes(32).toString("hex"));
  await snarkjs.powersOfTau.preparePhase2(t1, PTAU);
}

const r1cs = join(BUILD, "payroll.r1cs");
const zkey0 = join(BUILD, "payroll_0000.zkey");
const zkey = join(BUILD, "payroll_final.zkey");
console.log("groth16 setup ...");
await snarkjs.zKey.newZKey(r1cs, PTAU, zkey0);
await snarkjs.zKey.contribute(zkey0, zkey, "verity-demo-phase2", randomBytes(32).toString("hex"));
const vk = await snarkjs.zKey.exportVerificationKey(zkey);
writeFileSync(join(BUILD, "verification_key.json"), JSON.stringify(vk, null, 2));
console.log(`nPublic=${vk.nPublic} IC=${vk.IC.length}`);

const pub = join(ROOT, "frontend", "public", "zk");
mkdirSync(pub, { recursive: true });
copyFileSync(join(BUILD, "payroll_js", "payroll.wasm"), join(pub, "payroll.wasm"));
copyFileSync(zkey, join(pub, "payroll_final.zkey"));
copyFileSync(join(BUILD, "verification_key.json"), join(pub, "verification_key.json"));

const vkRs = join(ROOT, "programs", "verity_core", "programs", "verity_zk_verifier", "src", "vk.rs");
mkdirSync(dirname(vkRs), { recursive: true });
writeFileSync(vkRs, vkToRust(vk));
console.log(`wrote ${vkRs}`);
console.log("verification key sha256:", (await import("node:crypto")).createHash("sha256")
  .update(readFileSync(join(BUILD, "verification_key.json"))).digest("hex"));
process.exit(0);
