// End-to-end test of verity_zk_verifier against verity_core (run after setup-devnet.mjs
// and setup-zk.mjs). Proves with snarkjs, verifies on-chain:
//  1. honest receipt -> proof verifies, record.matches_receipt = true
//  2. tampered receipt -> correct proof verifies, matches_receipt = false (zk fraud proof)
//  3. forged public output (inflated net pay) -> InvalidProof
//  4. proof replayed onto another request -> InvalidProof (bound to the request PDA)
//  5. proof for a different input than the request committed -> InputMismatch
//
// Usage: DEPLOYER_KEYPAIR=/path/deployer.json node scripts/zk-smoke.mjs
import { Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { setup, pdas, namedKeypair, BN, LAMPORTS_PER_SOL, sha256, arr, receiptMessage, ed25519Sign } from "./common.mjs";
import { computeBudget, payrollInputJson, payrollOutputJson, provePayroll, zkPdas, zkProgram } from "./zk-common.mjs";

const { payer, provider: anchorProvider, program, programId } = setup();
const zk = zkProgram(anchorProvider);
const P = pdas(programId);
const Z = zkPdas(zk.programId);
const provider = namedKeypair("provider");
const providerPda = P.provider(provider.publicKey);
const configPda = P.config();
let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

const zkCfg = await zk.account.zkConfig.fetch(Z.config());
const programHash = Buffer.from(zkCfg.payrollProgramHash);
console.log("payroll program hash:", programHash.toString("hex"));

async function requestWithReceipt(input, outputJson) {
  const cfg = await program.account.config.fetch(configPda);
  const request = P.request(payer.publicKey, cfg.requestCount);
  const inputHash = sha256(payrollInputJson(input));
  const now = Math.floor(Date.now() / 1000);
  await program.methods
    .createRequest(arr(programHash), arr(inputHash), arr(sha256(`inputs/${inputHash.toString("hex")}.json`)),
      new BN(0.001 * LAMPORTS_PER_SOL), new BN(now + 900))
    .accountsPartial({ config: configPda, request, requester: payer.publicKey })
    .rpc();
  await program.methods.claimRequest()
    .accountsPartial({ config: configPda, request, provider: providerPda, providerOwner: provider.publicKey })
    .signers([provider]).rpc();
  const outputHash = sha256(outputJson);
  const trace = sha256("trace"), fuel = 1000;
  const msg = receiptMessage(request, programHash, inputHash, outputHash, trace, fuel);
  const sig = ed25519Sign(provider, msg);
  await program.methods
    .submitReceipt(arr(outputHash), arr(trace), new BN(fuel), arr(sig))
    .accountsPartial({ request, receipt: P.receipt(request), providerOwner: provider.publicKey, instructions: SYSVAR_INSTRUCTIONS_PUBKEY })
    .preInstructions([Ed25519Program.createInstructionWithPublicKey({ publicKey: provider.publicKey.toBytes(), message: msg, signature: sig })])
    .signers([provider]).rpc();
  return request;
}

function verifyTx(request, input, proof, tax = proof.tax, net = proof.net) {
  return zk.methods
    .verifyPayroll(proof.a, proof.b, proof.c, new BN(input.salary_cents), new BN(input.tax_bps),
      new BN(input.deductions_cents), new BN(tax.toString()), new BN(net.toString()))
    .accountsPartial({
      prover: payer.publicKey, zkConfig: Z.config(), request, receipt: P.receipt(request), record: Z.record(request),
    })
    .preInstructions([computeBudget()])
    .rpc();
}

async function expectError(fn, re, label) {
  try {
    await fn();
    check(false, `${label} (tx succeeded)`);
  } catch (e) {
    const text = String(e) + JSON.stringify(e.logs || e.transactionLogs || []);
    check(re.test(text), `${label} -> ${text.match(re)?.[0] ?? text.slice(0, 160)}`);
  }
}

const input = { salary_cents: 1000000, tax_bps: 2000, deductions_cents: 50000 };
const honestOut = payrollOutputJson(input, 200000, 750000);

console.log("\n== 1. honest receipt is zk-verified ==");
const r1 = await requestWithReceipt(input, honestOut);
const p1 = await provePayroll(input, r1);
const t0 = Date.now();
const s1 = await verifyTx(r1, input, p1);
console.log(`verify_payroll: ${s1} (${Date.now() - t0} ms)`);
let rec = await zk.account.zkProofRecord.fetch(Z.record(r1));
check(rec.matchesReceipt === true, "record.matches_receipt = true");
check(rec.netCents.toString() === "750000" && rec.taxCents.toString() === "200000", "proven tax/net recorded");

console.log("\n== 2. tampered receipt -> zk fraud proof ==");
const r2 = await requestWithReceipt(input, payrollOutputJson(input, 200000, 850000));
const p2 = await provePayroll(input, r2);
await verifyTx(r2, input, p2);
rec = await zk.account.zkProofRecord.fetch(Z.record(r2));
check(rec.matchesReceipt === false, "record.matches_receipt = false (receipt provably wrong)");

console.log("\n== 3/4/5. invalid proofs rejected ==");
const r3 = await requestWithReceipt(input, honestOut);
await expectError(() => verifyTx(r3, input, p1), /InvalidProof|0x1774/, "proof replayed from another request");
const p3 = await provePayroll(input, r3);
await expectError(() => verifyTx(r3, input, p3, p3.tax, p3.net + 100000n), /InvalidProof|0x1774/, "forged net pay");
const other = { salary_cents: 2000000, tax_bps: 2000, deductions_cents: 50000 };
const pOther = await provePayroll(other, r3);
await expectError(() => verifyTx(r3, other, pOther), /InputMismatch|0x1772/, "proof of a different input");
await verifyTx(r3, input, p3);
check((await zk.account.zkProofRecord.fetch(Z.record(r3))).matchesReceipt, "valid proof still accepted after failures");

const cfg = await zk.account.zkConfig.fetch(Z.config());
console.log(`zk config: verified=${cfg.verifiedCount} fraud=${cfg.fraudCount}`);
console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL ZK CHECKS PASSED");
process.exit(failures ? 1 : 0);
