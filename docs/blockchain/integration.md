# Integration — Talking to the Programs

How the frontend, backend and scripts use the two programs, and where the IDLs live.

## IDLs

| Copy | Used by |
|---|---|
| `programs/verity_core/idl/verity_core.json`, `verity_core.ts` | canonical copy (from the CI build artifact) |
| `programs/verity_core/idl/verity_zk_verifier.json`, `verity_zk_verifier.ts` | canonical copy |
| `programs/verity_core/target/idl/*.json` | devnet scripts (`common.mjs`, `zk-common.mjs`); not committed |
| `frontend/src/idl/verity_core.json`, `verity_core.ts` | frontend Anchor client (`src/lib/solana.ts`) |
| `frontend/src/idl/verity_zk_verifier.json` | reference only. `src/lib/zk.ts` builds the instruction by hand (discriminator + borsh) |
| `docs/blockchain/idl/*.json` | this documentation |
| *(backend)* | none: `backend/app/chain/client.py` and `zk.py` hand-encode instructions and Borsh schemas |

Whenever an instruction or account layout changes, update **all** copies and the backend's hand-written schemas (`ACCOUNT_SCHEMAS`, `EVENT_SCHEMAS` in `client.py`; `ZK_*_SCHEMA` in `zk.py`).

## Environment variables

**Backend (`backend/.env`, Render)**

| Var | Value / format |
|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` (or a Helius devnet URL; the public RPC rate-limits) |
| `PROGRAM_ID` | `ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1` |
| `ZK_PROGRAM_ID` | `A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv` |
| `CLUSTER` | `devnet` |
| `PROVIDER_KEYPAIR_JSON` | provider secret key |
| `VERIFIER_KEYPAIRS_JSON` | JSON array of 3 verifier secret keys |
| `ADMIN_KEYPAIR_JSON` | deployer secret key (falls back to the provider key if empty) |

A keypair value can be any of: a JSON array of 64 ints (solana-keygen file), a 32-int seed, a `{"secretKey": …}` object, a file path, hex, base64, or a base58 (Phantom export) string. See `backend/app/chain/keys.py`.

**Frontend (`frontend/.env.local`, Vercel)**

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SOLANA_RPC` | `https://api.devnet.solana.com` |
| `NEXT_PUBLIC_PROGRAM_ID` | `ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1` |
| `NEXT_PUBLIC_ZK_PROGRAM_ID` | `A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv` |
| `NEXT_PUBLIC_CLUSTER` | `devnet` |

## Who signs what

| Instruction | Signer | Where in code |
|---|---|---|
| `create_request` | requester's wallet (Phantom etc.) | `frontend/src/lib/solana.ts::createRequest` (Create Job page) |
| `open_dispute` | any wallet except the provider | `frontend/src/lib/solana.ts::openDispute` (request page, Dispute panel) |
| `register_provider`, `stake_provider` | provider wallet | `frontend/src/lib/solana.ts::registerAndStakeProvider`, `scripts/setup-devnet.mjs` |
| `claim_request`, `submit_receipt` | backend provider key | `backend/app/workers/provider.py` |
| `attest` | backend verifier keys (×3) | `backend/app/workers/verifier.py` |
| `finalize`, `resolve_dispute`, `expire_request` | anyone (backend finalizer bot) | `backend/app/workers/finalizer.py` |
| `anchor_audit_root`, `update_config`, `register_verifier` | admin (deployer) | `backend/app/chain/indexer.py::maybe_anchor_audit_root` (scheduled), `scripts/setup-devnet.mjs` |
| `verify_payroll` | any wallet | `frontend/src/lib/zk.ts::buildVerifyTx` (zk panel), `scripts/zk-prove.mjs` |
| `initialize` / `set_payroll_program_hash` (zk) | admin | `scripts/setup-zk.mjs` |

The backend never holds a requester's key.

## Reading state

**Frontend (Anchor, TypeScript)**

```ts
import { getProgram, requestPda, receiptPda } from "@/lib/solana";
import { fetchZkRecord } from "@/lib/zk";

const program = getProgram(connection, wallet);              // Program<VerityCore>
const req = await program.account.request.fetch(pda);         // status, hashes, counters
const rc  = await program.account.receipt.fetchNullable(receiptPda(pda));
const zk  = await fetchZkRecord(connection, pda);             // ZkProofRecord | null
```

**Backend (Python)**

```python
from app.chain.client import get_chain
from app.chain.zk import get_zk_record, zk_status

chain = get_chain()
req = await chain.get_request(pda)            # dict, hashes as hex
rc  = await chain.get_receipt(pda)
atts = await chain.list_attestations(pda)
open_reqs = await chain.list_requests("Open")
zk = await zk_status(pda, req["program_hash"])
```

**REST (public, no auth)**: these merge chain and database state.
- `GET /requests/{pda}`: full detail, including `chain`, `chain_receipt`, `integrity`, `zk`, `timeline` (with explorer links), `challenge`.
- `GET /requests/{pda}/trace`: published trace vs chain vs server re-execution, plus the first divergent step.
- `GET /requests/{pda}/zk`: zk eligibility and the proof record.
- `GET /requests/{pda}/evidence.zip`: offline evidence bundle (WASM, input, output, trace, receipt, tx list, `VERIFY.md`).

## Events → database

The backend indexer (`backend/app/chain/indexer.py`) pages `getSignaturesForAddress(PROGRAM_ID)`. It parses Anchor events from transaction logs (`parse_events_from_logs`), upserts the `requests` / `receipts` / `attestations` / `disputes` tables, and appends hash-chained `audit_log` rows. `sync_request(pda)` force-syncs one request from account state. zk events are not indexed; the zk record is read live.

## Typical transaction recipes

**Submit a receipt** (provider). Two instructions in one transaction:
```
[ Ed25519Program.createInstructionWithPublicKey({publicKey: provider, message: receiptMessage(...), signature}),
  verity_core.submit_receipt(output_hash, trace_root, fuel_used, signature)
     accounts: request, receipt PDA, provider_owner (signer), instructions sysvar ]
```

**zk verify** (any wallet):
```
[ ComputeBudgetProgram.setComputeUnitLimit(600_000),
  verity_zk_verifier.verify_payroll(proof_a, proof_b, proof_c, salary, tax_bps, deductions, tax, net)
     accounts: prover (signer, writable), zk_config, request, receipt, record PDA ["zk", request], system_program ]
```

**Resolve a dispute**: `remaining_accounts` = `(attestation PDA, verifier wallet [writable])` pairs for every counted mismatch attestation that agrees with the claimed hash.

## Command cheat-sheet

```bash
# independent verification of any request (reads chain + public storage, re-executes locally)
backend/verity-cli verify <request_pda> [--show-trace]       # Windows: backend\verity-cli.cmd
backend/verity-cli evidence bundle.zip                        # fully offline

# devnet scripts (run in programs/verity_core/, need target/idl/*.json from the CI artifact)
DEPLOYER_KEYPAIR=keys/deployer.json node scripts/setup-devnet.mjs     # config + provider + verifiers (idempotent)
DEPLOYER_KEYPAIR=keys/deployer.json node scripts/smoke-test.mjs       # happy path, forged sig, dispute + slash
DEPLOYER_KEYPAIR=keys/deployer.json PAYROLL_PROGRAM_HASH=<hex> node scripts/setup-zk.mjs
DEPLOYER_KEYPAIR=keys/deployer.json node scripts/zk-smoke.mjs         # zk verified / fraud / replay / forged / wrong input
DEPLOYER_KEYPAIR=keys/deployer.json SUPABASE_URL=<url> node scripts/zk-prove.mjs <request_pda>

# rule sets
cd rulesets && cargo build --release --target wasm32-unknown-unknown
python backend/scripts/seed_rulesets.py

# chain bootstrap from the backend side (alternative to setup-devnet.mjs)
python backend/scripts/bootstrap_chain.py
```

Explorer links: `https://explorer.solana.com/{address|tx}/<value>?cluster=devnet`.
