# Verity — Blockchain Reference

Everything about Verity's on-chain layer: program IDs, addresses, accounts, instructions, byte formats, IDLs, and how to build, deploy and integrate.

> Snapshot taken from Solana **devnet** on **2026-10-11**. Live values such as counters and balances will drift; the program IDs and formats will not.

## At a glance

| | |
|---|---|
| Cluster | Solana **devnet** (`https://api.devnet.solana.com`) |
| Framework | Anchor **0.32.1**, built with Agave **3.1.14** toolchain (CI) |
| `verity_core` program ID | [`ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1`](https://explorer.solana.com/address/ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1?cluster=devnet) |
| `verity_zk_verifier` program ID | [`A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv`](https://explorer.solana.com/address/A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv?cluster=devnet) |
| Upgrade + config authority (deployer) | `9uqynWB5rqeaqNsySnSLpxjL2Pgmet6Lqb4pSHCjmDqi` |
| Core `Config` PDA | `FpyQVwb2LNrC92fbGuoyAgQjyh8EV3puc5764bXmLMez` |
| zk `ZkConfig` PDA | `HosLLX2aiqNVBtFTtH7nDGTBnq7HLSUkpZ3iSA1oRKFC` |
| Provider wallet | `AxYv9q3deyufks6sT2hDSGG7Bt98TojNPxitDt62N3rZ` |
| Verifier wallets | `JAo46hP9dfksM5a494k4u8do8mXEs3osYkNPUafvCmvd`, `4vLmHBxA3vTRkXhF21spjYNMendrD8XGWjTPDk6sVJzA`, `32BBDkMx7hNenBByctsspZs8nZtruPa6whVc2eSkhdbB` |

## Files in this folder

| File | What's in it |
|---|---|
| [deployment.md](deployment.md) | Every devnet address (programs, ProgramData, PDAs, wallets), live config, notable transactions, key-file locations, and how to build, deploy, upgrade and run CI |
| [verity_core.md](verity_core.md) | The core program: request lifecycle, economics, Ed25519 receipt check, and a full reference of instructions, accounts, events and errors |
| [verity_zk_verifier.md](verity_zk_verifier.md) | The Groth16 zk verifier program: what it proves, the checks it runs, circuit public signals, and a full reference |
| [protocol-formats.md](protocol-formats.md) | Byte-exact formats: PDA seeds, receipt message, hashes, canonical JSON, TRACE_V2, zk encodings, discriminators |
| [integration.md](integration.md) | IDLs, env vars, how the frontend, backend and scripts talk to the chain, with code snippets and commands |
| [idl/verity_core.json](idl/verity_core.json) | Anchor IDL for `verity_core` (copy of `programs/verity_core/idl/`) |
| [idl/verity_zk_verifier.json](idl/verity_zk_verifier.json) | Anchor IDL for `verity_zk_verifier` |

## Architecture in one picture

```
Requester wallet ──create_request / open_dispute──►  verity_core  ◄──claim / submit_receipt── Provider (backend)
                                                     (requests,   ◄──attest───────────────── 3 Verifiers (backend)
Anyone ─────────finalize / resolve / expire──────►   receipts,    ◄──anchor_audit_root────── Admin (backend)
                                                     disputes)
                                                         ▲ reads Request + Receipt (no CPI)
Anyone (browser / CLI) ──verify_payroll(Groth16)──►  verity_zk_verifier ──► ZkProofRecord PDA + ZkVerified event
```

- **Hashes go on-chain, blobs stay off-chain.** WASM, inputs, outputs and traces live in Supabase Storage (and IPFS). The chain stores their SHA-256 commitments.
- **Two programs.** `verity_core` holds all state and money. `verity_zk_verifier` is an optional proof layer that reads core accounts. It never modifies them.

## Source locations

| What | Path |
|---|---|
| Anchor workspace | `programs/verity_core/` (`Anchor.toml`, `Cargo.toml`) |
| Core program source | `programs/verity_core/programs/verity_core/src/` (`lib.rs`, `state.rs`, `events.rs`, `errors.rs`, `ed25519.rs`) |
| zk verifier source | `programs/verity_core/programs/verity_zk_verifier/src/` (`lib.rs`, `groth16.rs`, `vk.rs` generated) |
| zk circuit | `zk/payroll/payroll.circom` |
| Devnet scripts | `programs/verity_core/scripts/` (`setup-devnet.mjs`, `smoke-test.mjs`, `setup-zk.mjs`, `zk-smoke.mjs`, `zk-prove.mjs`) |
| Backend chain client | `backend/app/chain/` (`client.py`, `indexer.py`, `signer.py`, `keys.py`, `zk.py`) |
| Frontend chain client | `frontend/src/lib/solana.ts`, `frontend/src/lib/zk.ts`, `frontend/src/idl/` |
