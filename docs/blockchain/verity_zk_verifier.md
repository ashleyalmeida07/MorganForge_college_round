# `verity_zk_verifier` — Groth16 zk Proof Verifier

Program ID `A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv` · Anchor 0.32.1 · source `programs/verity_core/programs/verity_zk_verifier/src/`

This is "proof of execution without re-execution" for the **payroll** rule set (Implementation_plan.md §4.1 stretch). Anyone can prove that a payroll request's correct output is X and have Solana verify it with a Groth16 pairing check. The result is recorded next to the request.

- **It never modifies `verity_core`.** It reads the core `Request` and `Receipt` accounts directly (Anchor checks owner and discriminator) and writes its own `ZkProofRecord`.
- **It is a circuit, not a zkVM.** The payroll arithmetic is hand-written in Circom (`zk/payroll/payroll.circom`, 236 constraints). SP1/RISC Zero needed 16–32 GB RAM to prove, which was not available.

## What `verify_payroll` checks

1. `request.program_hash == ZkConfig.payroll_program_hash`, so the proof is about the registered payroll WASM. Fails with `WrongProgram`.
2. It rebuilds the canonical input JSON `{"deductions_cents":D,"salary_cents":S,"tax_bps":B}` from the arguments and requires `sha256 == request.input_hash`. Fails with `InputMismatch`.
3. It verifies the Groth16 proof over BN254 using the `alt_bn128` syscalls:
   `e(−A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1`, with `vk_x = IC₀ + Σ inputᵢ·ICᵢ₊₁`. Fails with `InvalidProof`.
4. It rebuilds the canonical output JSON `{"deductions_cents":D,"gross_cents":S,"net_cents":N,"tax_cents":T}` and compares its sha256 with `receipt.output_hash`:
   - **equal**: `matches_receipt = true`. The provider's receipt is **zk-verified**.
   - **different**: `matches_receipt = false`. A **zk fraud proof**: the receipt is mathematically proven wrong.
5. It creates `ZkProofRecord` at `["zk", request]` (one per request; a second call fails because the account exists), updates `ZkConfig.verified_count` / `fraud_count`, and emits `ZkVerified`.

Clients prepend `ComputeBudgetProgram.setComputeUnitLimit(600_000)`.

## Circuit statement

```
tax_cents = floor(salary_cents * tax_bps / 10000)     (enforced as salary*bps = tax*10000 + rem, 0 ≤ rem < 10000)
net_cents = salary_cents − tax_cents − deductions_cents ≥ 0
range checks: salary, deductions, tax, net < 2^40; tax_bps ≤ 10000
```

The circuit matches `rulesets/payroll/src/lib.rs` exactly. Public signals, in snarkjs order (outputs first, then public inputs):

| # | Signal | Notes |
|---|---|---|
| 0 | `tax_cents` | output |
| 1 | `net_cents` | output |
| 2 | `salary_cents` | public input |
| 3 | `tax_bps` | public input |
| 4 | `deductions_cents` | public input |
| 5 | `request_hi` | first 16 bytes of the request PDA, big-endian integer |
| 6 | `request_lo` | last 16 bytes of the request PDA |

Signals 5–6 bind a proof to one request, so replaying it on another request fails with `InvalidProof`. Both are squared inside the circuit so they are real constraints.

## Trusted setup & artifacts

| Artifact | Location |
|---|---|
| Circuit | `zk/payroll/payroll.circom` (circomlib 2.0.5, circom 2.2.3) |
| Build script (compile + setup + export) | `zk/scripts/build.mjs` (`npm run build` in `zk/`) |
| Tests (prove, verify, forged, replay, negative net) | `zk/scripts/test.mjs` (`npm test`); also writes the Rust test fixture |
| Witness generator + proving key (browser) | `frontend/public/zk/payroll.wasm`, `payroll_final.zkey` |
| Verifying key (JSON) | `frontend/public/zk/verification_key.json` (sha256 `7bfccf02db4439ab05139e0875fb5317705d53b686a8fbf7b61f021811229b4f` at generation) |
| Verifying key (Rust constants) | `programs/verity_core/programs/verity_zk_verifier/src/vk.rs` (generated, do not edit) |
| CI copies | `programs/verity_core/zk-artifacts/` |

Setup is **demo-grade**. The public Hermez powers-of-tau mirrors returned HTTP 403, so phase 1 (2^10) and phase 2 were each a single local contribution. Production would need a multi-party ceremony.

> Re-running `npm run build` creates a **new** key. You must then rebuild and redeploy the program, and ship the new browser artifacts together with it.

## Proving

- **Browser:** on the request page, "Generate zk proof" calls `provePayroll()` in `frontend/src/lib/zk.ts`, using snarkjs loaded from `/zk/snarkjs.min.js` (~1 s). "Verify on Solana" then sends `verify_payroll` from the connected wallet.
- **CLI:** `DEPLOYER_KEYPAIR=keys/deployer.json SUPABASE_URL=https://<project>.supabase.co node scripts/zk-prove.mjs <request_pda>` (in `programs/verity_core/`). It fetches the input blob, checks it against the chain's `input_hash`, proves, and submits.
- **Backend (read-only):** `GET /requests/{pda}/zk` and the `zk` field of `GET /requests/{pda}` report eligibility and the decoded record (`backend/app/chain/zk.py`).

## Test coverage

| Test | Where |
|---|---|
| Native Rust verifier vs snarkjs proof (valid, forged net, request binding, negated A) | `tests/groth16_fixture.rs` (CI) |
| Local-validator end to end: zk-verified, fraud proof, replayed proof, forged net, wrong input, valid-after-failures | `scripts/zk-smoke.mjs` (CI) |
| Devnet: fraud proof against a real tampered receipt | record `BEtxnWxs2NANh5DM18zQhi6KvCApHZqWXQhnnMWvPzsi` |

---

# Reference (generated from `idl/verity_zk_verifier.json`)

Account seeds marked `(verity_core)` are derived under the core program ID.

## Instructions (3)

### `initialize`

One-time setup by the verity_core config authority.

Discriminator: `afaf6d1f0d989bed`

| Arg | Type |
|---|---|
| `payroll_program_hash` | `[u8; 32]` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `authority` | yes | yes |  |
| 1 | `core_config` |  |  | ["config"] (verity_core) |
| 2 | `zk_config` |  | yes | ["zk_config"] |
| 3 | `system_program` |  |  | `11111111111111111111111111111111` |

### `set_payroll_program_hash`

Point the payroll circuit at a rebuilt payroll WASM (new program hash).

Discriminator: `cc63fcc4e8f9d254`

| Arg | Type |
|---|---|
| `payroll_program_hash` | `[u8; 32]` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `authority` | yes |  |  |
| 1 | `zk_config` |  | yes | ["zk_config"] |

### `verify_payroll`

Discriminator: `d779072cbba585f2`

| Arg | Type |
|---|---|
| `proof_a` | `[u8; 64]` |
| `proof_b` | `[u8; 128]` |
| `proof_c` | `[u8; 64]` |
| `salary_cents` | `u64` |
| `tax_bps` | `u64` |
| `deductions_cents` | `u64` |
| `tax_cents` | `u64` |
| `net_cents` | `u64` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `prover` | yes | yes |  |
| 1 | `zk_config` |  | yes | ["zk_config"] |
| 2 | `request` |  |  |  |
| 3 | `receipt` |  |  | ["receipt", request] (verity_core) |
| 4 | `record` |  | yes | ["zk", request] |
| 5 | `system_program` |  |  | `11111111111111111111111111111111` |

## Accounts (5)

### `Config`

Discriminator: `9b0caae01efacc82`

| Field | Type |
|---|---|
| `authority` | `pubkey` |
| `min_provider_stake` | `u64` |
| `min_dispute_stake` | `u64` |
| `challenge_window_secs` | `i64` |
| `required_attestations` | `u8` |
| `request_count` | `u64` |
| `verifier_count` | `u32` |
| `latest_audit_root` | `[u8; 32]` |
| `audit_root_count` | `u64` |
| `bump` | `u8` |

### `Receipt`

Discriminator: `279a496a50669199`

| Field | Type |
|---|---|
| `request` | `pubkey` |
| `provider` | `pubkey` |
| `output_hash` | `[u8; 32]` |
| `trace_root` | `[u8; 32]` |
| `fuel_used` | `u64` |
| `signature` | `[u8; 64]` |
| `submitted_at` | `i64` |
| `bump` | `u8` |

### `Request`

Discriminator: `7dac96a1a2732747`

| Field | Type |
|---|---|
| `id` | `u64` |
| `requester` | `pubkey` |
| `program_hash` | `[u8; 32]` |
| `input_hash` | `[u8; 32]` |
| `input_uri_hash` | `[u8; 32]` |
| `bounty` | `u64` |
| `deadline` | `i64` |
| `status` | `RequestStatus` |
| `provider` | `pubkey` |
| `created_at` | `i64` |
| `receipt_at` | `i64` |
| `attest_count_match` | `u8` |
| `attest_count_mismatch` | `u8` |
| `attest_count_total` | `u8` |
| `settled` | `bool` |
| `bump` | `u8` |

### `ZkConfig`

Discriminator: `b5b0f2a76cdb0dca`

| Field | Type |
|---|---|
| `authority` | `pubkey` |
| `payroll_program_hash` | `[u8; 32]` |
| `verified_count` | `u64` |
| `fraud_count` | `u64` |
| `bump` | `u8` |

### `ZkProofRecord`

Discriminator: `cc928740fae31f05`

| Field | Type |
|---|---|
| `request` | `pubkey` |
| `prover` | `pubkey` |
| `circuit` | `[u8; 16]` |
| `program_hash` | `[u8; 32]` |
| `input_hash` | `[u8; 32]` |
| `receipt_output_hash` | `[u8; 32]` |
| `proven_output_hash` | `[u8; 32]` |
| `matches_receipt` | `bool` |
| `tax_cents` | `u64` |
| `net_cents` | `u64` |
| `verified_at` | `i64` |
| `slot` | `u64` |
| `bump` | `u8` |

## Events (1)

| Event | Fields |
|---|---|
| `ZkVerified` | `request: pubkey`, `prover: pubkey`, `circuit: [u8; 16]`, `proven_output_hash: [u8; 32]`, `receipt_output_hash: [u8; 32]`, `matches_receipt: bool` |

## Enums

- `RequestStatus`: 0 = `Open` · 1 = `Claimed` · 2 = `AwaitingVerification` · 3 = `Disputed` · 4 = `Verified` · 5 = `Rejected` · 6 = `Expired`

## Errors (5)

| Code | Hex | Name | Message |
|---|---|---|---|
| 6000 | `0x1770` | `Unauthorized` | signer is not the verity_core / zk config authority |
| 6001 | `0x1771` | `WrongProgram` | request is not for the registered payroll program |
| 6002 | `0x1772` | `InputMismatch` | proven input does not hash to the request's input_hash |
| 6003 | `0x1773` | `ReceiptMismatch` | receipt does not belong to this request |
| 6004 | `0x1774` | `InvalidProof` | Groth16 proof verification failed |
