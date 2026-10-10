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
