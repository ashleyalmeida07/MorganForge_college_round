// Prove a payroll request with Groth16 and verify it on-chain (verity_zk_verifier).
// The input is fetched from content-addressed storage and checked against the chain's input_hash.
//
// Usage: DEPLOYER_KEYPAIR=keys/deployer.json SUPABASE_URL=https://<project>.supabase.co \
//          node scripts/zk-prove.mjs <request_pda>
import { PublicKey } from "@solana/web3.js";
import { setup, pdas, BN, sha256 } from "./common.mjs";
import { computeBudget, payrollInputJson, payrollOutputJson, provePayroll, zkPdas, zkProgram } from "./zk-common.mjs";

const pdaArg = process.argv[2];
const supabase = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
if (!pdaArg || !supabase) throw new Error("usage: SUPABASE_URL=... node scripts/zk-prove.mjs <request_pda>");

const { payer, provider, program, programId } = setup();
const zk = zkProgram(provider);
const Z = zkPdas(zk.programId);
const request = new PublicKey(pdaArg);
const req = await program.account.request.fetch(request);
const inputHash = Buffer.from(req.inputHash).toString("hex");

const res = await fetch(`${supabase}/storage/v1/object/public/inputs/${inputHash}.json`);
if (!res.ok) throw new Error(`input blob: HTTP ${res.status}`);
const raw = await res.text();
if (sha256(raw).toString("hex") !== inputHash) throw new Error("INPUT TAMPERED: blob does not match chain input_hash");
const input = JSON.parse(raw);
if (payrollInputJson(input) !== raw) throw new Error("input is not a canonical payroll input");

const existing = await zk.account.zkProofRecord.fetchNullable(Z.record(request));
if (existing) {
  console.log("already proven:", { matchesReceipt: existing.matchesReceipt, record: Z.record(request).toBase58() });
  process.exit(0);
}

const t0 = Date.now();
const proof = await provePayroll(input, request);
console.log(`proved in ${Date.now() - t0} ms: tax=${proof.tax} net=${proof.net}`);
const receipt = await program.account.receipt.fetch(pdas(programId).receipt(request));
const proven = sha256(payrollOutputJson(input, proof.tax, proof.net)).toString("hex");
console.log(`proven output ${proven}\nreceipt output ${Buffer.from(receipt.outputHash).toString("hex")}`);

const sig = await zk.methods
  .verifyPayroll(proof.a, proof.b, proof.c, new BN(input.salary_cents), new BN(input.tax_bps),
    new BN(input.deductions_cents), new BN(proof.tax.toString()), new BN(proof.net.toString()))
  .accountsPartial({
    prover: payer.publicKey, zkConfig: Z.config(), request, receipt: pdas(programId).receipt(request), record: Z.record(request),
  })
  .preInstructions([computeBudget()])
  .rpc();
const rec = await zk.account.zkProofRecord.fetch(Z.record(request));
console.log(`verify_payroll: ${sig}`);
console.log(rec.matchesReceipt ? "ZK-VERIFIED: receipt proven correct" : "ZK FRAUD PROOF: receipt proven WRONG");
console.log(`record ${Z.record(request).toBase58()}`);
process.exit(0); // snarkjs keeps worker threads alive
