// End-to-end devnet smoke test (run after setup-devnet.mjs).
//  1. Happy path: create -> claim -> signed receipt -> 2 matching attestations -> finalize (Verified)
//  2. Forged receipt signature is rejected
//  3. Adversarial: tampered output -> mismatch attestations -> dispute -> slash (Rejected) -> refund
// Temporarily shortens the challenge window, and restores it at the end.
//
// Usage: DEPLOYER_KEYPAIR=/path/deployer.json node scripts/smoke-test.mjs
import { Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY, Keypair } from "@solana/web3.js";
import {
  setup, pdas, namedKeypair, BN, LAMPORTS_PER_SOL, sha256, arr, receiptMessage,
  ed25519Sign, sleep, sol,
} from "./common.mjs";

const { payer, connection, program, programId } = setup();
const P = pdas(programId);
const configPda = P.config();
const provider = namedKeypair("provider");
const [v1, v2] = [namedKeypair("verifier1"), namedKeypair("verifier2")];
const providerPda = P.provider(provider.publicKey);
const status = (s) => Object.keys(s)[0];
let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

const original = await program.account.config.fetch(configPda);
const params = (windowSecs) => ({
  minProviderStake: original.minProviderStake,
  minDisputeStake: original.minDisputeStake,
  challengeWindowSecs: new BN(windowSecs),
  requiredAttestations: original.requiredAttestations,
});
const WINDOW = 4;

async function createRequest(label) {
  const cfg = await program.account.config.fetch(configPda);
  const id = cfg.requestCount;
  const request = P.request(payer.publicKey, id);
  const programHash = sha256(`wasm:payroll:${label}`);
  const inputHash = sha256(`input:${label}:${Date.now()}`);
  const now = Math.floor(Date.now() / 1000);
  await program.methods
    .createRequest(arr(programHash), arr(inputHash), arr(sha256("ipfs://demo")),
      new BN(0.01 * LAMPORTS_PER_SOL), new BN(now + 900))
    .accountsPartial({ config: configPda, request, requester: payer.publicKey })
    .rpc();
  await program.methods
    .claimRequest()
    .accountsPartial({ config: configPda, request, provider: providerPda, providerOwner: provider.publicKey })
    .signers([provider])
    .rpc();
  return { request, programHash, inputHash };
}

function submitReceiptTx(r, outputHash, traceRoot, fuel, signerForSig = provider) {
  const msg = receiptMessage(r.request, r.programHash, r.inputHash, outputHash, traceRoot, fuel);
  const sig = ed25519Sign(signerForSig, msg);
  const edIx = Ed25519Program.createInstructionWithPublicKey({
    publicKey: signerForSig.publicKey.toBytes(),
    message: msg,
    signature: sig,
  });
  return program.methods
    .submitReceipt(arr(outputHash), arr(traceRoot), new BN(fuel), arr(sig))
    .accountsPartial({
      request: r.request,
      receipt: P.receipt(r.request),
      providerOwner: provider.publicKey,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .preInstructions([edIx])
    .signers([provider])
    .rpc();
}

function attest(r, kp, outputHash, traceRoot, fuel, registered = true) {
  return program.methods
    .attest(arr(outputHash), arr(traceRoot), new BN(fuel))
    .accountsPartial({
      request: r.request,
      receipt: P.receipt(r.request),
      attestation: P.attestation(r.request, kp.publicKey),
      verifierRecord: registered ? P.verifier(kp.publicKey) : null,
      verifier: kp.publicKey,
    })
    .signers(kp === payer ? [] : [kp])
    .rpc();
}

try {
  await program.methods.updateConfig(params(WINDOW))
    .accountsPartial({ config: configPda, authority: payer.publicKey }).rpc();

  // ---------------------------------------------------------- 1. happy path
  console.log("\n== happy path ==");
  const r1 = await createRequest("happy");
  const out = sha256("output:honest"), trace = sha256("trace:honest"), fuel = 123456;
  const s1 = await submitReceiptTx(r1, out, trace, fuel);
  console.log("submit_receipt:", s1);
  await attest(r1, v1, out, trace, fuel);
  await attest(r1, v2, out, trace, fuel);
  await attest(r1, payer, out, trace, fuel, false); // requester, unregistered: stored, not counted
  let req = await program.account.request.fetch(r1.request);
  check(req.attestCountMatch === 2 && req.attestCountTotal === 3, "2 counted matches, 3 total attestations");
  const provBalBefore = await connection.getBalance(provider.publicKey);
  await sleep((WINDOW + 3) * 1000);
  const fin = await program.methods.finalize()
    .accountsPartial({ config: configPda, request: r1.request, provider: providerPda, providerOwner: provider.publicKey })
    .rpc();
  console.log("finalize:", fin);
  req = await program.account.request.fetch(r1.request);
  const provBalAfter = await connection.getBalance(provider.publicKey);
  check(status(req.status) === "verified", `request ${r1.request.toBase58()} is Verified`);
  check(provBalAfter - provBalBefore === 0.01 * LAMPORTS_PER_SOL, "provider received the bounty");

  // ------------------------------------------ 2. forged signature rejected
  console.log("\n== forged signature ==");
  const r2 = await createRequest("adversarial");
  const tampered = sha256("output:tampered");
  let forgedRejected = false;
  try {
    await submitReceiptTx(r2, tampered, trace, fuel, Keypair.generate());
  } catch (e) {
    forgedRejected = /SignatureMismatch/.test(String(e) + JSON.stringify(e.logs || []));
    console.log("rejected as expected:", String(e.message || e).split("\n")[0]);
  }
  check(forgedRejected, "receipt signed by a different key is rejected");

  // ------------------------------- 3. tampered output -> dispute -> slash
  console.log("\n== tampered output -> dispute -> slash ==");
  const stakeBefore = (await program.account.provider.fetch(providerPda)).stake;
  await submitReceiptTx(r2, tampered, trace, fuel); // provider lies, but signs correctly
  await attest(r2, v1, out, trace, fuel); // honest verifiers recompute the real output
  await attest(r2, v2, out, trace, fuel);
  req = await program.account.request.fetch(r2.request);
  check(req.attestCountMismatch === 2, "2 counted mismatch attestations");
  const od = await program.methods.openDispute(arr(out))
    .accountsPartial({
      config: configPda, request: r2.request, receipt: P.receipt(r2.request),
      dispute: P.dispute(r2.request), challenger: v1.publicKey,
    })
    .signers([v1])
    .rpc();
  console.log("open_dispute:", od);
  const rs = await program.methods.resolveDispute()
    .accountsPartial({
      config: configPda, request: r2.request, dispute: P.dispute(r2.request),
      provider: providerPda, providerOwner: provider.publicKey, challenger: v1.publicKey,
    })
    .remainingAccounts([
      { pubkey: P.attestation(r2.request, v1.publicKey), isSigner: false, isWritable: false },
      { pubkey: v1.publicKey, isSigner: false, isWritable: true },
      { pubkey: P.attestation(r2.request, v2.publicKey), isSigner: false, isWritable: false },
      { pubkey: v2.publicKey, isSigner: false, isWritable: true },
    ])
    .rpc();
  console.log("resolve_dispute:", rs);
  req = await program.account.request.fetch(r2.request);
  const stakeAfter = (await program.account.provider.fetch(providerPda)).stake;
  check(status(req.status) === "rejected", `request ${r2.request.toBase58()} is Rejected`);
  check(stakeAfter.lt(stakeBefore), `provider slashed ${sol(stakeBefore.sub(stakeAfter))} SOL`);
  const reqBalBefore = await connection.getBalance(payer.publicKey);
  await program.methods.expireRequest()
    .accountsPartial({ request: r2.request, requester: payer.publicKey, provider: null })
    .rpc();
  req = await program.account.request.fetch(r2.request);
  check(req.settled, "bounty refunded to requester after rejection");
  console.log("requester balance delta (refund minus fee):",
    sol((await connection.getBalance(payer.publicKey)) - reqBalBefore));

  // restake provider for future runs
  const need = original.minProviderStake.sub(stakeAfter);
  if (need.gtn(0)) {
    await program.methods.stakeProvider(need)
      .accountsPartial({ provider: providerPda, owner: provider.publicKey })
      .signers([provider]).rpc();
    console.log("provider restaked", sol(need), "SOL");
  }
} finally {
  await program.methods.updateConfig(params(original.challengeWindowSecs.toNumber()))
    .accountsPartial({ config: configPda, authority: payer.publicKey }).rpc();
  console.log(`\nchallenge window restored to ${original.challengeWindowSecs.toString()}s`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
