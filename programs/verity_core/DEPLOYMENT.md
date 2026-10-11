# verity_core — devnet deployment

| Item | Value |
|---|---|
| Cluster | Solana devnet (`https://api.devnet.solana.com`) |
| Program ID | `ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1` |
| ProgramData | `CYwPSzs3DaDKggY7ZzAuDdoPP4dijQyo7hmRGYy6AbLx` |
| Upgrade authority / config authority | `9uqynWB5rqeaqNsySnSLpxjL2Pgmet6Lqb4pSHCjmDqi` |
| Config PDA (seed `"config"`) | initialized: min provider stake 0.2 SOL, min dispute stake 0.05 SOL, challenge window 120 s, quorum 2 |
| Provider (registered, staked 0.2 SOL) | `AxYv9q3deyufks6sT2hDSGG7Bt98TojNPxitDt62N3rZ` |
| Verifiers (registered) | `JAo46hP9dfksM5a494k4u8do8mXEs3osYkNPUafvCmvd`, `4vLmHBxA3vTRkXhF21spjYNMendrD8XGWjTPDk6sVJzA`, `32BBDkMx7hNenBByctsspZs8nZtruPa6whVc2eSkhdbB` |

Explorer: https://explorer.solana.com/address/ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1?cluster=devnet

## Files
- `idl/verity_core.json`, `idl/verity_core.ts` — IDL + TS types for frontend/backend (copy to `frontend/src/idl/` and the backend).
- `keys/` (gitignored, never commit): `deployer.json`, `verity_core-keypair.json`, `provider.json`, `verifier1-3.json`.

## Tests (local validator, every push: `programs` job in `/.github/workflows/ci.yml`)
`tests/verity_core.test.mjs` covers Implementation_plan.md §5.6: (1) happy path → Verified + bounty paid,
(2) tampered receipt → mismatch quorum → dispute → Rejected + slash, (3) unstaked provider cannot claim,
(4) forged signature and replayed receipt rejected (`SignatureMismatch`), (5) finalize before the window
fails (`ChallengeWindowOpen`), (6) expire refunds the bounty, plus (7) frivolous dispute → provider wins
the challenger's stake. `scripts/zk-smoke.mjs` case 6 sends a corrupted Groth16 proof (proof A negated,
chaos `ZK_CORRUPT_PROOF`) → `InvalidProof`. The root CI uses a throwaway deployer key and loads both
`.so` files at their `declare_id!` addresses, so it needs no secrets.
```
solana-test-validator --reset --bpf-program <core id> target/deploy/verity_core.so \
  --bpf-program <zk id> target/deploy/verity_zk_verifier.so &
export RPC_URL=http://127.0.0.1:8899 DEPLOYER_KEYPAIR=~/.config/solana/id.json
node scripts/setup-devnet.mjs && node --test tests/verity_core.test.mjs && node scripts/smoke-test.mjs
```
`tests/verity_core.test.mjs` refuses devnet/mainnet URLs (it rewrites the challenge window). The
`.github/workflows/build.yml` in this folder is the root workflow of the private build mirror (GitHub
ignores nested `.github/` directories); keep it in sync with the root CI.

## Verified on devnet (scripts/smoke-test.mjs)
1. Happy path: create → claim → Ed25519-signed receipt → 2 registered-verifier attestations → finalize → Verified, bounty paid.
2. Receipt signed by the wrong key → rejected (`SignatureMismatch`).
3. Tampered output → 2 mismatch attestations → dispute → resolve → Rejected, provider slashed, bounty refunded.

## Differences from Implementation_plan.md §5
- Only attestations from admin-registered verifiers (`register_verifier`) count toward quorum; anyone can still attest (stored, `counted=false`). Prevents Sybil finalize/slash.
- `Request.provider` is a `Pubkey` (default = unclaimed) instead of `Option<Pubkey>`; added `attest_count_total` and `settled`.
- `resolve_dispute` takes evidence as `remaining_accounts` pairs `(attestation PDA, verifier wallet [writable])`. Slash = min(stake, min_provider_stake): half to challenger, half split among supporting verifiers. On challenger win the bounty is refunded via `expire_request`.
- Extra admin ixs: `update_config`, `transfer_authority`, `set_verifier_active`; provider can `unstake_provider` when it has no active jobs.

## Redeploy (upgrade)
Build in CI (private repo `JACELL100/verity-solana-build`, workflow runs build + local-validator tests), download the `verity_core-build` artifact, then from a machine with the Solana CLI:
```
solana program deploy target/deploy/verity_core.so --program-id keys/verity_core-keypair.json \
  --upgrade-authority keys/deployer.json -k keys/deployer.json -u devnet --with-compute-unit-price 50000
DEPLOYER_KEYPAIR=keys/deployer.json node scripts/setup-devnet.mjs   # idempotent
DEPLOYER_KEYPAIR=keys/deployer.json node scripts/smoke-test.mjs
```
Deploying from GitHub Actions to public devnet stalls (RPC rate limits on shared runner IPs); deploy locally or use a dedicated RPC (Helius) URL.

The same steps are wrapped by `scripts/deploy_program.sh core|zk [--so file] [--setup] [--smoke]` at the repo
root (checks the program keypair against `declare_id!`, asks before deploying). `scripts/deploy_program.py`
does the deploy/upgrade through the upgradeable BPF loader directly (solders, no CLI; §15.3) — slower,
for machines without the Solana CLI.

## verity_zk_verifier (Groth16 payroll proofs) — devnet

| Item | Value |
|---|---|
| Program ID | `A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv` (keypair `keys/verity_zk_verifier-keypair.json`) |
| Deploy tx | `2CdDXH9z6S1fSuBtZn9fwjDso2gLci42bnBsvyPi2LVpgjYY6jvmiMDM26vDu1zt3KnLqBLhDvU7kidWEC2bEtNC` |
| ZkConfig PDA (`"zk_config"`) | `HosLLX2aiqNVBtFTtH7nDGTBnq7HLSUkpZ3iSA1oRKFC`, payroll program hash `d74c9d44eb9e66521303b9ac2d109e8cebbfb4afa5fd13fc16a04d12465c936c` |
| First devnet proof | request `9maChiY26oWFFUauVdvBQfm4Yo3hCAcHdM3gexwsQ2dN` (tampered receipt) → zk fraud proof record `BEtxnWxs2NANh5DM18zQhi6KvCApHZqWXQhnnMWvPzsi` |

Circuit, setup and verifying key: `zk/` (`npm run build` regenerates `src/vk.rs`, `zk-artifacts/` and `frontend/public/zk/`; a new setup **requires a redeploy**).

```
solana program deploy target/deploy/verity_zk_verifier.so --program-id keys/verity_zk_verifier-keypair.json \
  --upgrade-authority keys/deployer.json -k keys/deployer.json -u devnet --with-compute-unit-price 50000
DEPLOYER_KEYPAIR=keys/deployer.json PAYROLL_PROGRAM_HASH=<sha256 of rulesets/payroll/payroll.wasm> node scripts/setup-zk.mjs
DEPLOYER_KEYPAIR=keys/deployer.json SUPABASE_URL=https://<project>.supabase.co node scripts/zk-prove.mjs <request_pda>
```
Deploy without `--use-rpc`: buffer writes over the public RPC hit 429 rate limits; the default TPU/QUIC path succeeds.
