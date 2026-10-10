# Protocol Formats (byte-exact)

Every party computes these values independently: the programs (Rust), the backend (Python), the browser (TypeScript) and the CLI. If you change any of them, change all implementations together and re-run the cross-checks listed at the end.

## PDA seeds

`u64le` = 8-byte little-endian. All seeds are raw bytes; strings are UTF-8.

| Account | Program | Seeds |
|---|---|---|
| `Config` | verity_core | `"config"` |
| `Provider` | verity_core | `"provider"`, provider owner pubkey |
| `VerifierRecord` | verity_core | `"verifier"`, verifier pubkey |
| `Request` | verity_core | `"request"`, requester pubkey, `u64le(id)` where `id = Config.request_count` at creation |
| `Receipt` | verity_core | `"receipt"`, request PDA |
| `Attestation` | verity_core | `"attestation"`, request PDA, verifier pubkey |
| `Dispute` | verity_core | `"dispute"`, request PDA |
| `ZkConfig` | verity_zk_verifier | `"zk_config"` |
| `ZkProofRecord` | verity_zk_verifier | `"zk"`, request PDA |

Implementations: `frontend/src/lib/solana.ts`, `frontend/src/lib/zk.ts`, `backend/app/chain/client.py`, `backend/app/chain/zk.py`, `programs/verity_core/scripts/common.mjs`.

## Hash commitments (stored in `Request`)

| Field | Definition |
|---|---|
| `program_hash` | `sha256(wasm_bytes)` of the rule-set module |
| `input_hash` | `sha256(canonical_json(input))` |
| `input_uri_hash` | `sha256(utf8("inputs/<input_hash_hex>.json"))`, the storage URI (Supabase bucket `inputs`) |
| `output_hash` (Receipt) | `sha256(output_bytes)`: the exact bytes the WASM returned, already canonical JSON |
| `trace_root` (Receipt) | TRACE_V2 root (below) |

Anything loaded from storage must re-hash to these values; otherwise it is reported as **TAMPERED**.

## Canonical JSON

Sorted keys, no whitespace, UTF-8, non-ASCII not escaped, integers only (no floats). This is byte-identical to:

```python
json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
```

Implementations: `backend/app/utils.py` (`canonical`), `frontend/src/lib/hash.ts` (`canonicalJson`), `rulesets/verity_abi` (`canonical`, a serde_json `Value` backed by a BTreeMap; never enable `preserve_order`).

## Receipt message

The provider signs this message with Ed25519 (its Solana keypair). `verity_core::submit_receipt` checks it via the Ed25519 precompile.

```
"VERITY_RECEIPT_V1"      17 bytes (ASCII)
request_pda              32
program_hash             32
input_hash               32
output_hash              32
trace_root               32
fuel_used                 8  (u64 little-endian)
                        ---
                        185 bytes
```

The Ed25519 instruction must carry exactly 1 signature, with all data inline (offset instruction index = itself). Implementations: `lib.rs::receipt_message`, `backend/app/chain/signer.py`, `scripts/common.mjs::receiptMessage`.

## Rule-set WASM ABI

| Export | Signature | Meaning |
|---|---|---|
| `memory` | memory | linear memory |
| `alloc` | `(len: i32) -> i32` | buffer for the input bytes |
| `compute` | `(ptr: i32, len: i32) -> i32` | pointer to `[u32 LE len][output bytes]` (canonical JSON) |
| `trace` *(optional)* | `() -> i32` | pointer to `[u32 LE len][NDJSON checkpoints]`; call after `compute` |

The module has **zero imports**: no WASI, clock, randomness or floats in outputs. `fuel_used` is wasmtime fuel consumed by `compute` only, read before calling `trace()`, with a limit of 50,000,000. Fuel counts differ between wasmtime releases, so everyone must run **wasmtime 49.0.0**.

## TRACE_V2 execution trace

```
steps      = [input_bytes, checkpoint_1, …, checkpoint_n, output_bytes]
             checkpoint_i = one NDJSON line from trace(): {"state":…,"step":"<label>"} (canonical)
leaf_i     = sha256("VERITY_TRACE_LEAF_V2" || u32le(i) || sha256(step_i))
node       = sha256(0x01 || left || right)                 odd node at a level is carried up unchanged
trace_root = sha256("VERITY_TRACE_V2" || u32le(leaf_count) || merkle_root)
```

- Modules without `trace()` have just `[input, output]`.
- Merkle proof for leaf `i`: a list of `{side: "left"|"right", hash}` siblings, bottom-up. Verify by folding with the node rule, then wrapping with the root domain.
- The provider publishes the document at `outputs/<request_pda>.trace.json`. It contains `version`, `leaf_count`, `merkle_root`, `trace_root`, `fuel_used` and `steps[]`, where each step has `index`, `kind`, `step_hash`, `leaf`, plus `label`/`data`/`state` for checkpoints up to 2 KB.
- **First divergent step** = the first index where the published leaves differ from an independent run.

Implementations: `backend/app/engine/trace.py`, `frontend/src/lib/trace.ts`, `rulesets/verity_abi/src/lib.rs` (`checkpoint`).

## zk (Groth16 / BN254) encodings

| Item | Encoding |
|---|---|
| G1 point | `x(32) ‖ y(32)`, big-endian |
| G2 point | `x.c1(32) ‖ x.c0(32) ‖ y.c1(32) ‖ y.c0(32)`, big-endian (imaginary part first). snarkjs gives `[[c0,c1],[c0,c1]]` |
| Scalars / public inputs | 32-byte big-endian, must be `< r` (BN254 scalar field) |
| `proof_a` | sent **un-negated**; the program negates it (`y → p − y`) |
| Public signals | `[tax_cents, net_cents, salary_cents, tax_bps, deductions_cents, request_hi, request_lo]` |
| `request_hi`, `request_lo` | `BigInt(pda[0..16])`, `BigInt(pda[16..32])` (big-endian) |
| Canonical payroll input rebuilt on-chain | `{"deductions_cents":D,"salary_cents":S,"tax_bps":B}` |
| Canonical payroll output rebuilt on-chain | `{"deductions_cents":D,"gross_cents":S,"net_cents":N,"tax_cents":T}` |

`verify_payroll` instruction data = discriminator `d779072cbba585f2` ‖ `proof_a[64]` ‖ `proof_b[128]` ‖ `proof_c[64]` ‖ `u64le` × 5 (salary, tax_bps, deductions, tax, net).

## Anchor conventions

| Item | Rule |
|---|---|
| Instruction discriminator | `sha256("global:<snake_case_name>")[0..8]` |
| Account discriminator | `sha256("account:<StructName>")[0..8]`, the first 8 bytes of account data |
| Event discriminator | `sha256("event:<EventName>")[0..8]`. Events are emitted as `Program data: <base64>` log lines |
| Custom error codes | start at **6000** (`0x1770`), in declaration order. See the error tables in each program doc |
| Borsh layout | fields in declaration order; `Pubkey` 32 bytes; `bool` 1 byte; enums 1-byte variant index |

## Off-chain audit log anchoring

```
row_hash = sha256_hex(prev_hash_hex_ascii || canonical_json(payload))      genesis prev_hash = "0" * 64
```

The backend periodically writes the newest `row_hash` on-chain with `anchor_audit_root` (`Config.latest_audit_root`, `audit_root_count`).

## Cross-implementation checks

| Check | How |
|---|---|
| Rust vs Python vs browser execution + TRACE_V2 | `backend/tests/test_engine_trace.py`; transpile `frontend/src/lib/{hash,trace,verify}.ts` and run against every `rulesets/*/*.wasm` (all six matched byte-for-byte) |
| snarkjs vs on-chain Groth16 | `programs/verity_core/programs/verity_zk_verifier/tests/groth16_fixture.rs` (CI) |
| Receipt bytes + Ed25519 | `scripts/smoke-test.mjs` (CI); `test_signed_receipt_binds_request_and_trace` |
