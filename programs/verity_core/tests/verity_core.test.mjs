// verity_core program tests (Implementation_plan.md §5.6), run on solana-test-validator:
//   1. happy path to Verified (bounty paid)
//   2. tampered receipt -> mismatch attestations -> dispute -> Rejected + slash
//   3. unstaked provider cannot claim
//   4. forged receipt signature rejected (+ replay of a valid receipt onto another request, scenario 7)
//   5. finalize before the challenge window fails
//   6. expire refunds the bounty
//   7. frivolous dispute -> provider wins the challenger's stake (scenario 8)
//
// Prereq: program deployed + `node scripts/setup-devnet.mjs` (config, staked provider, 3 verifiers).
// Usage:  RPC_URL=http://127.0.0.1:8899 DEPLOYER_KEYPAIR=~/.config/solana/id.json node tests/verity_core.test.mjs
// Never point this at devnet: it rewrites the challenge window while it runs.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Ed25519Program, Keypair, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";

import {
  BN, LAMPORTS_PER_SOL, RPC_URL, arr, ed25519Sign, fundIfLow, namedKeypair, pdas, receiptMessage, setup, sha256, sleep,
} from "../scripts/common.mjs";

if (/devnet|mainnet/.test(RPC_URL)) throw new Error(`refusing to run program tests against ${RPC_URL}`);

const { payer, connection, program, programId } = setup();
const P = pdas(programId);
const configPda = P.config();
const provider = namedKeypair("provider");
const [v1, v2] = [namedKeypair("verifier1"), namedKeypair("verifier2")];
const providerPda = P.provider(provider.publicKey);
const BOUNTY = 0.01 * LAMPORTS_PER_SOL;
const WINDOW = 3;
const status = (s) => Object.keys(s)[0];
let original;

const params = (windowSecs) => ({
  minProviderStake: original.minProviderStake,
  minDisputeStake: original.minDisputeStake,
  challengeWindowSecs: new BN(windowSecs),
  requiredAttestations: original.requiredAttestations,
});
const setWindow = (secs) =>
  program.methods.updateConfig(params(secs)).accountsPartial({ config: configPda, authority: payer.publicKey }).rpc();

/** Assert that `fn` fails with Anchor error `code` (matched in the error text or program logs). */
async function rejects(fn, code) {
  try {
    await fn();
  } catch (e) {
    const text = `${e}\n${JSON.stringify(e?.logs ?? e?.transactionLogs ?? [])}\n${e?.error?.errorCode?.code ?? ""}`;
    assert.match(text, new RegExp(code), `expected ${code}, got: ${String(e).split("\n")[0]}`);
    return;
  }
  assert.fail(`expected the transaction to fail with ${code}`);
}

/** The validator's clock (deadlines and windows are checked against it, not the wall clock). */
async function chainNow() {
  return (await connection.getBlockTime(await connection.getSlot("confirmed"))) ?? Math.floor(Date.now() / 1000);
}

/** Retry `fn` while it fails with a time-gated error (`code`), e.g. until the window has elapsed. */
async function whenAllowed(fn, code, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const text = `${e}
${JSON.stringify(e?.logs ?? e?.transactionLogs ?? [])}`;
      if (!new RegExp(code).test(text) || Date.now() > end) throw e;
      await sleep(1000);
    }
  }
}

async function createRequest(label, { requester = payer, deadlineSecs = 900 } = {}) {
  const cfg = await program.account.config.fetch(configPda);
  const request = P.request(requester.publicKey, cfg.requestCount);
  const programHash = sha256(`wasm:${label}`);
  const inputHash = sha256(`input:${label}:${Date.now()}:${Math.random()}`);
  await program.methods
    .createRequest(arr(programHash), arr(inputHash), arr(sha256(`inputs/${label}.json`)),
      new BN(BOUNTY), new BN((await chainNow()) + deadlineSecs))
    .accountsPartial({ config: configPda, request, requester: requester.publicKey })
    .signers(requester === payer ? [] : [requester])
    .rpc();
  return { request, programHash, inputHash, requester };
}

const claim = (r, owner = provider) =>
  program.methods.claimRequest()
    .accountsPartial({ config: configPda, request: r.request, provider: P.provider(owner.publicKey), providerOwner: owner.publicKey })
    .signers([owner])
    .rpc();

/** submit_receipt preceded by an Ed25519 verify instruction over `message` (default: this request's receipt). */
function submitReceipt(r, outputHash, traceRoot, fuel, { signer = provider, message, signature } = {}) {
  const msg = message ?? receiptMessage(r.request, r.programHash, r.inputHash, outputHash, traceRoot, fuel);
  const sig = signature ?? ed25519Sign(signer, msg);
  return program.methods
    .submitReceipt(arr(outputHash), arr(traceRoot), new BN(fuel), arr(sig))
    .accountsPartial({
      request: r.request, receipt: P.receipt(r.request), providerOwner: provider.publicKey,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .preInstructions([Ed25519Program.createInstructionWithPublicKey({
      publicKey: signer.publicKey.toBytes(), message: msg, signature: sig,
    })])
    .signers([provider])
    .rpc();
}

const attest = (r, kp, outputHash, traceRoot, fuel) =>
  program.methods.attest(arr(outputHash), arr(traceRoot), new BN(fuel))
    .accountsPartial({
      request: r.request, receipt: P.receipt(r.request), attestation: P.attestation(r.request, kp.publicKey),
      verifierRecord: P.verifier(kp.publicKey), verifier: kp.publicKey,
    })
    .signers([kp])
    .rpc();

const finalize = (r) =>
  program.methods.finalize()
    .accountsPartial({ config: configPda, request: r.request, provider: providerPda, providerOwner: provider.publicKey })
    .rpc();

const openDispute = (r, challenger, claimed) =>
  program.methods.openDispute(arr(claimed))
    .accountsPartial({
      config: configPda, request: r.request, receipt: P.receipt(r.request), dispute: P.dispute(r.request),
      challenger: challenger.publicKey,
    })
    .signers([challenger])
    .rpc();

const resolveDispute = (r, challenger, evidence = []) =>
  program.methods.resolveDispute()
    .accountsPartial({
      config: configPda, request: r.request, dispute: P.dispute(r.request), provider: providerPda,
      providerOwner: provider.publicKey, challenger: challenger.publicKey,
    })
    .remainingAccounts(evidence.flatMap((kp) => [
      { pubkey: P.attestation(r.request, kp.publicKey), isSigner: false, isWritable: false },
      { pubkey: kp.publicKey, isSigner: false, isWritable: true },
    ]))
    .rpc();

async function restakeProvider() {
  const prov = await program.account.provider.fetch(providerPda);
  const need = original.minProviderStake.sub(prov.stake);
  if (need.gtn(0)) {
    await fundIfLow(connection, payer, provider.publicKey, need.toNumber() / LAMPORTS_PER_SOL + 0.1, 1);
    await program.methods.stakeProvider(need)
      .accountsPartial({ provider: providerPda, owner: provider.publicKey })
      .signers([provider]).rpc();
  }
}

const out = sha256("output:honest");
const trace = sha256("trace:honest");
const FUEL = 123_456;

before(async () => {
  original = await program.account.config.fetch(configPda);
  assert.ok(original.requiredAttestations <= 2, "tests assume a quorum of at most 2 verifiers");
  await setWindow(WINDOW);
  await restakeProvider();
});

after(async () => {
  if (original) await setWindow(original.challengeWindowSecs.toNumber());
});

test("1. happy path: receipt + quorum of matching attestations -> Verified, bounty paid", async () => {
  const r = await createRequest("happy");
  await claim(r);
  await submitReceipt(r, out, trace, FUEL);
  await attest(r, v1, out, trace, FUEL);
  await attest(r, v2, out, trace, FUEL);
  const before = await connection.getBalance(provider.publicKey);
  const completedBefore = (await program.account.provider.fetch(providerPda)).completed;
  await whenAllowed(() => finalize(r), "ChallengeWindowOpen");
  const req = await program.account.request.fetch(r.request);
  assert.equal(status(req.status), "verified");
  assert.ok(req.settled);
  assert.equal((await connection.getBalance(provider.publicKey)) - before, BOUNTY, "provider receives the bounty");
  assert.equal((await program.account.provider.fetch(providerPda)).completed, completedBefore + 1);
});

test("2. tampered receipt -> mismatch attestations -> dispute -> Rejected + provider slashed", async () => {
  const r = await createRequest("tampered");
  await claim(r);
  const tampered = sha256("output:tampered");
  await submitReceipt(r, tampered, trace, FUEL); // signed correctly, but the output is a lie
  await attest(r, v1, out, trace, FUEL);
  await attest(r, v2, out, trace, FUEL);
  let req = await program.account.request.fetch(r.request);
  assert.equal(req.attestCountMismatch, 2);
  await rejects(() => finalize(r), "QuorumNotReached|ChallengeWindowOpen");

  const provBefore = await program.account.provider.fetch(providerPda);
  await openDispute(r, v1, out);
  assert.equal(status((await program.account.request.fetch(r.request)).status), "disputed");
  await resolveDispute(r, v1, [v1, v2]); // challenger wins immediately with quorum evidence
  req = await program.account.request.fetch(r.request);
  const provAfter = await program.account.provider.fetch(providerPda);
  const dispute = await program.account.dispute.fetch(P.dispute(r.request));
  assert.equal(status(req.status), "rejected");
  assert.equal(status(dispute.status), "challengerWon");
  assert.equal(provAfter.slashed, provBefore.slashed + 1);
  assert.ok(provAfter.stake.lt(provBefore.stake), "stake slashed");

  const reqBal = await connection.getBalance(payer.publicKey);
  await program.methods.expireRequest()
    .accountsPartial({ request: r.request, requester: payer.publicKey, provider: null }).rpc();
  assert.ok((await program.account.request.fetch(r.request)).settled, "bounty refundable after rejection");
  assert.ok((await connection.getBalance(payer.publicKey)) > reqBal, "requester refunded (net of the tx fee)");
  await restakeProvider();
});

test("3. a registered but unstaked provider cannot claim", async () => {
  const lazy = Keypair.generate();
  await fundIfLow(connection, payer, lazy.publicKey, 0.05, 0.05);
  await program.methods.registerProvider()
    .accountsPartial({ provider: P.provider(lazy.publicKey), owner: lazy.publicKey })
    .signers([lazy]).rpc();
  const r = await createRequest("unstaked");
  await rejects(() => claim(r, lazy), "InsufficientStake");
  assert.equal(status((await program.account.request.fetch(r.request)).status), "open");
  await claim(r); // a staked provider still can
});

test("4. forged receipt signature and replayed receipt are rejected on-chain", async () => {
  const r = await createRequest("forged");
  await claim(r);
  await rejects(() => submitReceipt(r, out, trace, FUEL, { signer: Keypair.generate() }), "SignatureMismatch");

  // replay: the provider's valid signature over request A's receipt, submitted for request B. The
  // Ed25519 instruction itself verifies; verity_core rejects it because the message binds A's PDA.
  const msgA = receiptMessage(r.request, r.programHash, r.inputHash, out, trace, FUEL);
  const sigA = ed25519Sign(provider, msgA);
  const b = await createRequest("replay");
  await claim(b);
  await rejects(() => submitReceipt(b, out, trace, FUEL, { message: msgA, signature: sigA }), "SignatureMismatch");
  assert.equal(await connection.getAccountInfo(P.receipt(b.request)), null, "no receipt account created");

  await submitReceipt(r, out, trace, FUEL); // the genuine receipt still lands
  assert.equal(status((await program.account.request.fetch(r.request)).status), "awaitingVerification");
});

test("5. finalize before the challenge window has elapsed fails", async () => {
  const r = await createRequest("early");
  await claim(r);
  await submitReceipt(r, out, trace, FUEL);
  await attest(r, v1, out, trace, FUEL);
  await attest(r, v2, out, trace, FUEL);
  await setWindow(3600);
  try {
    await rejects(() => finalize(r), "ChallengeWindowOpen");
    assert.equal(status((await program.account.request.fetch(r.request)).status), "awaitingVerification");
  } finally {
    await setWindow(WINDOW);
  }
  await whenAllowed(() => finalize(r), "ChallengeWindowOpen");
  assert.equal(status((await program.account.request.fetch(r.request)).status), "verified");
});

test("6. expire after the deadline refunds the bounty to the requester", async () => {
  const requester = Keypair.generate();
  await fundIfLow(connection, payer, requester.publicKey, 0.1, 0.1);
  const r = await createRequest("expire", { requester, deadlineSecs: 4 });
  const expire = () =>
    program.methods.expireRequest()
      .accountsPartial({ request: r.request, requester: requester.publicKey, provider: null }).rpc();
  await rejects(expire, "DeadlineNotReached");
  const before = await connection.getBalance(requester.publicKey);
  await whenAllowed(expire, "DeadlineNotReached"); // fee paid by the test payer: the requester's delta is exactly the bounty
  const req = await program.account.request.fetch(r.request);
  assert.equal(status(req.status), "expired");
  assert.ok(req.settled);
  assert.equal((await connection.getBalance(requester.publicKey)) - before, BOUNTY);
  await rejects(expire, "InvalidStatus"); // no double refund
});

test("7. frivolous dispute against an honest receipt: provider wins the challenger's stake", async () => {
  const challenger = Keypair.generate();
  await fundIfLow(connection, payer, challenger.publicKey, 0.2, 0.2);
  const r = await createRequest("frivolous");
  await claim(r);
  await submitReceipt(r, out, trace, FUEL);
  await attest(r, v1, out, trace, FUEL);
  await attest(r, v2, out, trace, FUEL);
  await rejects(() => openDispute(r, challenger, out), "ClaimMatchesReceipt");
  await openDispute(r, challenger, sha256("made-up output"));
  await rejects(() => resolveDispute(r, challenger), "ChallengeWindowOpen"); // no evidence: wait the window
  await rejects(() => resolveDispute(r, challenger, [v1]), "InvalidEvidence"); // matching attestations are not evidence
  const before = await connection.getBalance(provider.publicKey);
  await whenAllowed(() => resolveDispute(r, challenger), "ChallengeWindowOpen");
  const dispute = await program.account.dispute.fetch(P.dispute(r.request));
  assert.equal(status(dispute.status), "providerWon");
  assert.equal((await connection.getBalance(provider.publicKey)) - before, original.minDisputeStake.toNumber());
  await finalize(r);
  assert.equal(status((await program.account.request.fetch(r.request)).status), "verified");
});
