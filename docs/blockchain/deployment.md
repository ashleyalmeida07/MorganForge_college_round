# Deployment — Addresses, Keys, Build & Deploy

All addresses are on Solana **devnet**. Explorer links use `?cluster=devnet`.

## Programs

| Program | Program ID | ProgramData account | Size | Rent held |
|---|---|---|---|---|
| `verity_core` | `ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1` | `CYwPSzs3DaDKggY7ZzAuDdoPP4dijQyo7hmRGYy6AbLx` | 915,725 bytes | ~4.65 SOL |
| `verity_zk_verifier` | `A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv` | `DTwrtBS4NFfnNPEQ3t5zrX5t89HJKQ2JXSN7e8J1gyUg` | 259,141 bytes | ~1.32 SOL |

Both programs are **upgradeable**. The upgrade authority for both is `9uqynWB5rqeaqNsySnSLpxjL2Pgmet6Lqb4pSHCjmDqi` (the deployer).

| Program | Deployed | Deploy transaction |
|---|---|---|
| `verity_core` | 2026-10-10 | (see Explorer history of the program ID) |
| `verity_zk_verifier` | 2026-10-11 | `2CdDXH9z6S1fSuBtZn9fwjDso2gLci42bnBsvyPi2LVpgjYY6jvmiMDM26vDu1zt3KnLqBLhDvU7kidWEC2bEtNC` |

## Wallets / roles

| Role | Public key | Used by |
|---|---|---|
| Deployer, upgrade authority, `Config.authority`, `ZkConfig.authority` | `9uqynWB5rqeaqNsySnSLpxjL2Pgmet6Lqb4pSHCjmDqi` | deploys, `update_config`, `register_verifier`, `anchor_audit_root` (backend `ADMIN_KEYPAIR_JSON`) |
| Provider | `AxYv9q3deyufks6sT2hDSGG7Bt98TojNPxitDt62N3rZ` | backend provider worker (`PROVIDER_KEYPAIR_JSON`) |
| Verifier 1 | `JAo46hP9dfksM5a494k4u8do8mXEs3osYkNPUafvCmvd` | backend verifier worker (`VERIFIER_KEYPAIRS_JSON[0]`) |
| Verifier 2 | `4vLmHBxA3vTRkXhF21spjYNMendrD8XGWjTPDk6sVJzA` | `VERIFIER_KEYPAIRS_JSON[1]` |
| Verifier 3 | `32BBDkMx7hNenBByctsspZs8nZtruPa6whVc2eSkhdbB` | `VERIFIER_KEYPAIRS_JSON[2]` |

## Program-derived addresses (fixed)

| Account | Seeds | Address |
|---|---|---|
| Core `Config` | `["config"]` | `FpyQVwb2LNrC92fbGuoyAgQjyh8EV3puc5764bXmLMez` |
| `Provider` (provider wallet) | `["provider", AxYv9q…N3rZ]` | `6z3ky9Pi5vXs2H9ANGphajGYxyLrh1EwYCLJHDmy3JX9` |
| `VerifierRecord` (verifier 1) | `["verifier", JAo46h…Cmvd]` | `EhFUkDVJUYcBQFy7Er24y7AuG79JumBMDsMKoMBAP6MG` |
| `VerifierRecord` (verifier 2) | `["verifier", 4vLmHB…VJzA]` | `85s8sCmAaAb1nsNKp44rBb7cWJUnjqGwgs8t16LM61fD` |
| `VerifierRecord` (verifier 3) | `["verifier", 32BBDk…hdbB]` | `5BAoaUy3YjGbqLpsKBsK9V2Cb2yHkB4cmXcSTPyZMePZ` |
| zk `ZkConfig` | `["zk_config"]` (zk program) | `HosLLX2aiqNVBtFTtH7nDGTBnq7HLSUkpZ3iSA1oRKFC` |

Per-request PDAs (`Request`, `Receipt`, `Attestation`, `Dispute`, `ZkProofRecord`) are derived as described in [protocol-formats.md](protocol-formats.md#pda-seeds).

## Live configuration (snapshot 2026-10-11)

**Core `Config`**

| Field | Value |
|---|---|
| `min_provider_stake` | 200,000,000 lamports (0.2 SOL) |
| `min_dispute_stake` | 50,000,000 lamports (0.05 SOL) |
| `challenge_window_secs` | 120 |
| `required_attestations` (quorum) | 2 |
| `verifier_count` | 3 (all active) |
| `request_count` | 6 |
| `audit_root_count` | 5 |

**zk `ZkConfig`**

| Field | Value |
|---|---|
| `payroll_program_hash` | `d74c9d44eb9e66521303b9ac2d109e8cebbfb4afa5fd13fc16a04d12465c936c` (= sha256 of `rulesets/payroll/payroll.wasm`) |
| `verified_count` / `fraud_count` | 0 / 1 |

**Provider account:** stake 0.2 SOL, `completed` 1, `slashed` 2, `active` true.

## Rule-set program hashes (registered in Supabase `programs`)

Requests commit to these as `program_hash`. The `.wasm` files are committed in `rulesets/<crate>/<crate>.wasm`, so the hashes are stable.

| Rule set | program_hash (sha256 of WASM) |
|---|---|
| payroll | `d74c9d44eb9e66521303b9ac2d109e8cebbfb4afa5fd13fc16a04d12465c936c` |
| loan_amortization | `0ea9a8529edd1c53036a836e5507b18cef6c361405b695c00ccd943087f76c31` |
| tax_india | `4c2e67faf40e41a97fb4e89a9e4c96b964cdd9ac60c04ecf0ef51b45a1ce99bf` |
| stats_outliers | `0b385ed9e5b3915febb90384a000e80b8de1fa61ec5a36fcda49fbbd1152bf72` |
| credit_risk | `a2f6bd3f79fd1569fd249fdcf28f947ed068549b9f04be3781dd5d6e730017ce` |
| ml_inference | `71b7b6d910cceac3010702b67627c526131bd585356f1b6a6a708d74bfcafca4` |

## Notable devnet records

| What | Address / tx |
|---|---|
| Adversarial run: tampered payroll receipt, then 3 mismatch attestations, dispute, provider slashed, Rejected | request `9maChiY26oWFFUauVdvBQfm4Yo3hCAcHdM3gexwsQ2dN` |
| Dispute resolution for that request | tx `4SMUgj3Edi7stpn3mYmFj9SCfvWzUmGzXtcxcrRBA2UMsoYEyiz724gdJWbmHghpHZCnShyK6bMPEiCdPDF2uqFj` |
| First zk fraud proof (Groth16 proves the receipt wrong) | `ZkProofRecord` `BEtxnWxs2NANh5DM18zQhi6KvCApHZqWXQhnnMWvPzsi` |

## Keys (secret — never commit, never paste)

| File | Purpose |
|---|---|
| `programs/verity_core/keys/deployer.json` | deployer / upgrade authority / admin |
| `programs/verity_core/keys/verity_core-keypair.json` | `verity_core` program-ID keypair |
| `programs/verity_core/keys/verity_zk_verifier-keypair.json` | `verity_zk_verifier` program-ID keypair |
| `programs/verity_core/keys/provider.json` | provider wallet |
| `programs/verity_core/keys/verifier1.json` … `verifier3.json` | verifier wallets |

- `keys/` is gitignored. The backend reads the same keys from `backend/.env` (`PROVIDER_KEYPAIR_JSON`, `VERIFIER_KEYPAIRS_JSON`, `ADMIN_KEYPAIR_JSON`).
- CI gets them from GitHub secrets (`DEPLOYER_KEYPAIR`, `PROGRAM_KEYPAIR`, `ACTOR_KEYS`).
- Losing the deployer key means neither program can ever be upgraded again.

## Build (CI)

Solana programs are **not built locally**: the dev PC has low RAM and Windows. Builds run in the private repo **`JACELL100/verity-solana-build`**, which mirrors `programs/verity_core/`.

Workflow `.github/workflows/build.yml` (~7 min):
1. Installs Agave 3.1.14 and a prebuilt Anchor 0.32.1, then runs `anchor build` (both programs).
2. `cargo test -p verity_zk_verifier --test groth16_fixture`: native Groth16 verifier tests against a snarkjs-generated proof.
3. Uploads artifact `verity_core-build`: both `.so` files, both IDLs, the TS types and `Cargo.lock`.
4. Starts `solana-test-validator` with both programs loaded, then runs `setup-devnet.mjs`, `smoke-test.mjs`, `setup-zk.mjs` and `zk-smoke.mjs`.

To build: copy changed files from `programs/verity_core/` into a clone of that repo, push to `main`, wait for green, then:

```bash
gh run download <run-id> -R JACELL100/verity-solana-build -n verity_core-build -D ./art
```

## Deploy / upgrade (local, Agave CLI)

```bash
# verity_core upgrade
solana program deploy art/target/deploy/verity_core.so --program-id keys/verity_core-keypair.json \
  --upgrade-authority keys/deployer.json -k keys/deployer.json -u devnet --with-compute-unit-price 50000

# verity_zk_verifier upgrade
solana program deploy art/target/deploy/verity_zk_verifier.so --program-id keys/verity_zk_verifier-keypair.json \
  --upgrade-authority keys/deployer.json -k keys/deployer.json -u devnet --with-compute-unit-price 50000

# post-deploy (idempotent)
DEPLOYER_KEYPAIR=keys/deployer.json node scripts/setup-devnet.mjs
DEPLOYER_KEYPAIR=keys/deployer.json PAYROLL_PROGRAM_HASH=<sha256 payroll.wasm> node scripts/setup-zk.mjs
```

After an upgrade, copy the new IDL to `programs/verity_core/idl/`, `frontend/src/idl/` and `docs/blockchain/idl/`, but only if the interface changed.

### Gotchas (learned the hard way)

- **Do not use `--use-rpc`** for deploys. Buffer writes through the public devnet RPC hit HTTP 429 and fail after a few minutes. The default TPU/QUIC path succeeds.
- **A failed deploy leaves a buffer holding SOL.** Recover it with `solana program close <BUFFER> -k keys/deployer.json -u devnet --bypass-warning`; the deployer is the buffer authority.
- **Deploying from GitHub Actions to devnet stalls** (shared-IP rate limits) and leaks buffers. Deploy locally.
- **Regenerating the zk trusted setup** (`zk/ npm run build`) changes `vk.rs`. Old proofs and browser artifacts stop verifying until the program is rebuilt and redeployed.
- **Rebuilding a rule set changes its `program_hash`.** For payroll you must also run `setup-zk.mjs` with the new hash.
- **Keep `wasmtime==49.0.0`** in every backend/verifier/CLI (`backend/requirements.txt`). Fuel metering differs between wasmtime versions and attestations compare `fuel_used`, so mixed versions get honest receipts rejected.

## Costs (devnet)

| Item | Approx. |
|---|---|
| `verity_core` program rent | 4.65 SOL |
| `verity_zk_verifier` program rent | 1.32 SOL |
| Per request (bounty escrow + `Request` rent) | bounty + ~0.003 SOL |
| `verify_payroll` | ~0.003 SOL `ZkProofRecord` rent + fee (clients set a 600k compute-unit limit) |

Devnet SOL: `solana airdrop 2 <pubkey> -u devnet` or https://faucet.solana.com.
