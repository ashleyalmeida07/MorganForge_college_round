# Verifiable Computation & Independent Verification (Implementation_plan.md §4.1–4.2)

What is built, where it lives, and how to check it yourself.

| Feature | Tier | Where |
|---|---|---|
| Deterministic WASM rule sets (wasmtime + browser, identical results) | MVP | `rulesets/`, `backend/app/engine/runner.py`, `frontend/src/lib/verify.ts` |
| Content-addressed commitments (SHA-256 of program, input, output) | MVP | `backend/app/routes/requests.py` (`/requests/prepare`), `verity_core` `Request`/`Receipt` |
| Signed execution receipt (Ed25519, verified on-chain) | MVP | `backend/app/chain/signer.py`, `verity_core::submit_receipt` (Ed25519 introspection) |
| Execution-trace Merkle root (TRACE_V2) + first divergent step | Plus | `rulesets/verity_abi`, `backend/app/engine/trace.py`, `frontend/src/lib/trace.ts` |
| zk proof verified on-chain (Groth16, payroll) | Stretch | `zk/`, `programs/verity_core/programs/verity_zk_verifier`, `frontend/src/lib/zk.ts` |
| Verifier worker pool (3 registered keypairs, attest on-chain) | MVP | `backend/app/workers/verifier.py` |
| "Verify in my browser" | MVP | `frontend/src/components/verify/BrowserVerifyPanel.tsx` |
| `verity-cli verify <request_pda>` | Plus | `backend/verity-cli(.cmd)`, `backend/scripts/verity_cli.py` |
| Public verification page `/verify/[pda]` + QR | Plus | `frontend/src/app/verify/[pda]/page.tsx` |

## Rule sets

Six Rust crates compiled to `wasm32-unknown-unknown`. Each uses no imports, no floats, no clock and no randomness, and emits canonical JSON.

| Crate | What it computes | Trace checkpoints |
|---|---|---|
| `payroll` | gross / tax / net pay (cents, bps) | gross, tax, net |
| `loan_amortization` | EMI + full schedule (1e12 fixed point) | EMI + one per month |
| `tax_india` | New regime FY 2025-26: slabs, 87A rebate, surcharge, cess, marginal relief | per slab, rebate, surcharge, total |
| `stats_outliers` | mean / variance / stddev / quartiles / IQR outliers (milli units) | running sums every 64 values, moments, quartiles, outliers |
| `credit_risk` | 300–850 rule-based score + tier | each factor |
| `ml_inference` | 4-4-1 MLP, fixed-point weights baked in, LUT sigmoid | features, hidden layer, logit, probability |

Every crate shares `verity_abi::export_ruleset!`, which exports `alloc`, `compute` and the optional `trace()` export. The built modules are committed next to each crate (`rulesets/<crate>/<crate>.wasm`), so program hashes stay stable even when the toolchain changes.

```bash
cd rulesets && cargo build --release --target wasm32-unknown-unknown   # rebuild (changes hashes!)
python backend/scripts/seed_rulesets.py                                   # upload + programs table + IPFS
```

## TRACE_V2 — execution trace Merkle root

```
steps      = [input, checkpoint_1 .. checkpoint_n, output]     (checkpoints: NDJSON from trace())
leaf_i     = sha256("VERITY_TRACE_LEAF_V2" || u32le(i) || sha256(step_i))
node       = sha256(0x01 || left || right)        (odd node carried up)
trace_root = sha256("VERITY_TRACE_V2" || u32le(leaf_count) || merkle_root)
```

* The provider signs `trace_root` inside the receipt, so it goes on-chain. It also publishes the full trace at `outputs/<pda>.trace.json`.
* Verifiers recompute the root. `attest` on-chain only counts a match when `output_hash`, `trace_root` and `fuel_used` all agree.
* The browser, `GET /requests/{pda}/trace` and `verity-cli` compare the published leaves against an independent run. They report the **first divergent step**, e.g. "step 21/38 (month)", and a Merkle proof for it.
* Fuel is committed separately in the receipt, not in the root, because browsers cannot meter fuel. The browser therefore checks `output_hash` and `trace_root`.

## Groth16 zk proof (payroll)

The payroll rule set also exists as a 236-constraint circuit, `zk/payroll/payroll.circom`. Its public signals are `[tax, net, salary, tax_bps, deductions, request_hi, request_lo]`, so a proof is bound to one request PDA.

`verity_zk_verifier::verify_payroll` makes these checks on-chain:
1. The request's `program_hash` must be the registered payroll WASM hash (`ZkConfig`).
2. `sha256(canonical input JSON rebuilt from the proven integers) == request.input_hash`.
3. The Groth16 proof must verify. This uses the alt_bn128 syscalls: `e(-A,B)·e(α,β)·e(vk_x,γ)·e(C,δ) = 1`.
4. `sha256(canonical output JSON) == receipt.output_hash`. If equal, the receipt is **zk-verified**. If not, the record is a **zk fraud proof**: the receipt is provably wrong.

The result is an immutable `ZkProofRecord` PDA (`["zk", request]`) plus a `ZkVerified` event. Proving takes about 1 s, in the browser (request page → "Generate zk proof") or in Node (`zk/scripts`).

Trusted setup: the public Hermez ptau mirrors returned 403, so `zk/scripts/build.mjs` ran a local single-contributor phase 1 and phase 2. That is fine for a demo. Production would need a multi-party ceremony.

```bash
cd zk && npm install && npm run build && npm test     # compile, setup, prove/verify, write fixture
```

## Independent verification paths

1. **Verifier pool.** Three admin-registered keypairs each re-execute and call `attest`. A quorum of 2 matches finalizes; a quorum of mismatches backs a dispute.
2. **Browser.** It fetches the WASM and input from content-addressed storage, re-hashes them against Solana, runs `WebAssembly.instantiate(wasm, {})`, and rebuilds the trace. It then compares against the receipt and against the provider's published trace. Results are byte-identical to wasmtime for all six rule sets.
3. **CLI.** `backend/verity-cli verify <request_pda> [--show-trace]` reads the chain directly. It re-hashes blobs, re-executes in wasmtime, checks the Ed25519 receipt signature and the published trace, and finds the first divergent step. `verity-cli evidence <bundle.zip>` does the same fully offline.
4. **Public page.** `/verify/<pda>` needs no login. It offers browser verification, the zk badge, a QR code and the CLI hint.

## Tests

| Suite | Command | Covers |
|---|---|---|
| Engine / trace (offline) | `cd backend && .venv/Scripts/python -m pytest tests/test_engine_trace.py` | determinism, commitments, Merkle proofs, divergence, tamper paths, receipt replay |
| Browser == wasmtime | transpile `frontend/src/lib/{hash,trace,verify}.ts`, run in Node WebAssembly + WebCrypto | identical output hash + trace root for every rule set |
| zk circuit | `cd zk && npm test` | valid proof, forged output, PDA binding, negative net unprovable |
| On-chain (CI, local validator) | `programs/verity_core/.github/workflows/build.yml` | native Groth16 verifier tests; core smoke test; `zk-smoke.mjs` (verified / fraud proof / replay / forged / wrong input) |
| Devnet adversarial E2E | `VERITY_E2E=1 pytest -m devnet tests/test_adversarial.py` | §10 scenarios against a running deployment |
