# Verity backend (FastAPI)

The backend is the off-chain half of Verity. It runs the provider and verifier
nodes, indexes the `verity_core` Solana program into Supabase, keeps the
hash-chained audit log, and serves the REST API the Next.js frontend uses.

The chain is the source of truth. Supabase is a cache/index, and everything it
stores can be re-checked against on-chain hashes (see `scripts/verity_cli.py`).

---

## 1. Local setup

Requirements: Python 3.11+, a Supabase project, and a Solana devnet RPC (the
public one works). The program is already deployed; its ID is in `.env.example`.

```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate      macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                  # then fill in the values (see the table below)
```

### 1.1 Database schema

Set `DATABASE_URL` in `.env`. Copy it from Supabase: Project Settings, Database,
Connection string, URI. The direct connection (port 5432) or the pooler (port
6543) both work. Then run:

```bash
python scripts/apply_migration.py
```

This applies `../supabase/migrations/*.sql` in order. The migration is
idempotent and creates:
- all tables, indexes and RLS policies
- the `auth.users` to `profiles` trigger
- the append-only guard on `audit_log`
- the chaos-flag seed rows
- the public storage buckets (`programs`, `inputs`, `outputs`)
- the Realtime publication

You can also paste `supabase/migrations/0001_init.sql` into the Supabase SQL editor.

### 1.2 Keypairs

```bash
python scripts/gen_keypairs.py           # writes backend/keys/*.json (gitignored)
```

Copy the printed `PROVIDER_KEYPAIR_JSON=…`, `VERIFIER_KEYPAIRS_JSON=…` and
`ADMIN_KEYPAIR_JSON=…` lines into `.env`. Use `--print` to show them again.
The script will not overwrite existing keys unless you pass `--force`.

Note: the admin key must be the program's **config authority**. If the config
was already initialized with another key (for example the deployer from
`programs/verity_core/scripts/setup-devnet.mjs`), put that key in
`ADMIN_KEYPAIR_JSON`.

### 1.3 Chain bootstrap

```bash
python scripts/bootstrap_chain.py
#   --min-provider-stake 0.1 --min-dispute-stake 0.05 --window 60 --quorum 2
#   --provider-stake 0.3 --update-config --no-airdrop --rpc <url>
```

The script prints balances and airdrops 1 SOL to low-balance keys on devnet
(failures are tolerated; you can use https://faucet.solana.com instead). It
then initializes the config if it is missing, registers and stakes the
provider, and registers the verifiers. Re-running it is safe.

### 1.4 Rule sets

```bash
# build each crate first: cargo build --release --target wasm32-unknown-unknown
python scripts/seed_rulesets.py            # --dir ../rulesets --only payroll --dry-run --no-ipfs
```

For each `rulesets/<crate>/` the script does the following:
- finds the built `.wasm` and the optional `meta.json`
- validates the module's ABI and runs `example_input`
- uploads `programs/{hash}.wasm` and `programs/{hash}.src.txt`
- pins the wasm to IPFS (if Pinata is configured)
- upserts the `programs` row

### 1.5 Run

```bash
uvicorn app.main:app --reload --port 8000
```

Use `WORKERS_ENABLED=false` to run only the API, with no background jobs.

---

## 2. Environment variables

Never commit `.env` or `backend/keys/`.

| Variable | Required | Description |
|---|---|---|
| `SOLANA_RPC_URL` | yes | Solana RPC endpoint (default `https://api.devnet.solana.com`; Helius devnet recommended) |
| `PROGRAM_ID` | yes | Deployed `verity_core` program ID |
| `CLUSTER` | yes | `devnet` (used for explorer links and airdrops) |
| `PROVIDER_KEYPAIR_JSON` | yes | Provider node key: JSON array of 64 bytes, base64, or base58 secret |
| `VERIFIER_KEYPAIRS_JSON` | yes | JSON array of verifier keys (3 recommended) |
| `ADMIN_KEYPAIR_JSON` | recommended | Config authority (falls back to the provider key) |
| `SUPABASE_URL` | yes | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key (backend only; bypasses RLS) |
| `SUPABASE_JWT_SECRET` | yes | Used to verify user access tokens |
| `DATABASE_URL` | scripts only | Postgres URI for `scripts/apply_migration.py` |
| `PINATA_JWT` | optional | Pinata JWT for IPFS pinning |
| `PINATA_API_KEY` / `PINATA_API_SECRET` | optional | Legacy Pinata key pair (used if no JWT) |
| `PINATA_GATEWAY` | optional | Gateway host, e.g. `xyz.mypinata.cloud` (default `gateway.pinata.cloud`) |
| `FRONTEND_ORIGIN` | yes | Comma-separated CORS origins (e.g. `http://localhost:3000,https://verity.vercel.app`) |
| `ADMIN_EMAILS` | yes | Comma-separated emails that get the admin role |
| `WORKERS_ENABLED` | no | `true` (default) runs provider, verifier, finalizer and indexer jobs in-process |
| `GROQ_API_KEY` / `ANTHROPIC_API_KEY` | optional | AI dispute explainer |

The following also have defaults in `app/config.py`:
- `PROVIDER_INTERVAL_SECS` (8)
- `VERIFIER_INTERVAL_SECS` (8)
- `FINALIZER_INTERVAL_SECS` (15)
- `INDEXER_INTERVAL_SECS` (10)
- `AUDIT_ANCHOR_EVERY` (20)
- `FUEL_LIMIT` (50,000,000)

---

## 3. Architecture

```
app/
├── main.py            FastAPI app, CORS, routers, scheduler start/stop
├── config.py          pydantic-settings (backend/.env)
├── utils.py           canonical JSON, sha256, explorer links
├── db.py              Supabase service-role client, storage blobs, chaos flags
├── audit.py           append-only hash-chained audit log (row_hash = sha256(prev_hash || canonical(payload)))
├── auth.py            Supabase JWT auth, admin role
├── ipfs.py            Pinata pinning (optional, failures swallowed)
├── ai.py              "explain this dispute" (Groq / Anthropic, optional)
├── evidence.py        evidence.zip bundles (request, receipt, attestations, blobs)
├── chain/
│   ├── keys.py        keypair parsing (provider / verifiers / admin / payer)
│   ├── signer.py      receipt message + Ed25519 sign/verify
│   ├── client.py      manual Anchor encoding: PDAs, account reads, instructions
│   └── indexer.py     program events → Supabase rows + audit log; audit-root anchoring
├── engine/
│   └── runner.py      wasmtime sandbox (fuel-metered, no imports), trace_root
├── workers/
│   ├── provider.py    claim Open requests → verify hashes → execute → sign → submit_receipt
│   ├── verifier.py    independently re-execute → attest (match / mismatch) → open disputes
│   ├── finalizer.py   resolve disputes, finalize after the window, expire stale requests
│   └── scheduler.py   APScheduler jobs (max_instances=1, coalesce)
└── routes/            REST API (below)
```

**Integrity model.** Every blob is stored at a content-addressed path:
- `programs/{program_hash}.wasm`
- `inputs/{input_hash}.json`
- `outputs/{request_pda}.json`

Every executor re-hashes these blobs against the on-chain commitments before
it uses them. The provider signs:

```
b"VERITY_RECEIPT_V1" || request_pda || program_hash || input_hash || output_hash || trace_root || fuel_used_le
```

The program checks this signature through Ed25519 instruction introspection.
Because the message includes `request_pda`, an old receipt cannot be replayed
on a new request. Verifiers re-execute the job and attest on-chain. A
mismatch quorum leads to a dispute, which ends in the provider being slashed.
The audit log is hash-chained in the database: deletes are blocked, and the
only update allowed is setting `anchored_tx`. Every `AUDIT_ANCHOR_EVERY`
rows, the chain head is anchored on Solana.

---

## 4. API

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness + worker status |
| GET | `/config` | program id, cluster, rpc, config account, provider / verifier pubkeys |
| POST | `/auth/wallet/nonce` | `{wallet}` → `{nonce, message}` |
| POST | `/auth/wallet/link` | `{wallet, signature, nonce}` (signature base58 or base64) |
| GET | `/me` | current user, role, linked wallets |
| GET | `/programs` | rule sets |
| GET | `/programs/{hash}` | rule set detail |
| POST | `/programs` | multipart upload: wasm, source?, name, description, version, language, input_schema, output_schema, example_input, expected_hash? |
| POST | `/requests/prepare` | `{program_hash, input}` → canonical input, `input_hash`, `input_uri`, `input_uri_hash`, `input_url`, `ipfs_cid` |
| POST | `/requests/confirm` | `{request_pda, tx_sig, title?}` after the wallet sends `create_request` |
| GET | `/requests` | `?scope=mine\|all&status=&wallet=` |
| GET | `/requests/{pda}` | request, receipt, attestations, dispute, timeline |
| GET | `/requests/{pda}/artifacts` | public URLs + hashes of program / input / output |
| GET | `/requests/{pda}/evidence.zip` | self-contained evidence bundle |
| POST | `/requests/{pda}/reverify` | server-side re-execution integrity report |
| POST | `/disputes/prepare` | `{request_pda, claimed_output_hash}` → PDAs + min stake |
| GET | `/disputes` | disputes |
| GET | `/providers` | provider leaderboard |
| GET | `/verifiers` | verifier records |
| GET | `/activity` | `?limit=` audit / event feed |
| GET | `/audit/verify` | recompute the audit hash chain |
| GET | `/stats` | landing-page counters |
| GET/POST | `/admin/chaos` | `{flag, enabled}` (admin) |
| POST | `/admin/tamper` | `{request_pda, target: "input"\|"output"}` (admin) |
| POST | `/admin/bootstrap` | initialize config, register + stake provider, register verifiers (admin) |
| POST | `/admin/sync/{pda}` | force re-index of one request (admin) |
| POST | `/admin/run/{job}` | run a worker job immediately (admin) |
| POST | `/ai/explain-dispute` | `{request_pda}` → `{text}` |

---

## 5. Chaos flags (adversarial testing)

Toggle these from `/admin` or `POST /admin/chaos`. They are stored in the
`chaos_flags` table.

| Flag | Effect | Expected outcome |
|---|---|---|
| `PROVIDER_TAMPER_OUTPUT` | provider alters its output before signing | verifier mismatch quorum, then dispute, then **Rejected** with the provider slashed |
| `PROVIDER_SWAP_PROGRAM` | provider runs a different WASM | provider's own hash check aborts (request expires and is refunded), or verifiers mismatch |
| `STORAGE_TAMPER_INPUT` | input blob edited after creation | every executor's re-hash fails; `InputTampered` audit event; request expires |
| `STORAGE_TAMPER_OUTPUT` | output blob edited after receipt | UI/CLI re-hash shows a red banner; the chain record is unaffected |
| `PROVIDER_BAD_SIG` | receipt signed with the wrong key | on-chain Ed25519 check rejects the tx; no receipt is stored |
| `VERIFIER_LAZY` | one verifier copies the provider's hash without executing | lazy verifier is outvoted; its wrong attestation stays on-chain |

End-to-end suite (against a deployment, never run in CI):

```bash
VERITY_E2E=1 VERITY_API_URL=https://<render-app>.onrender.com VERITY_ADMIN_TOKEN=<admin jwt> \
REQUESTER_KEYPAIR_JSON='[...]' pytest -m devnet tests/test_adversarial.py -v -s
```

Offline verification of any request or evidence bundle:

```bash
python scripts/verity_cli.py verify <request_pda> [--rpc URL] [--api URL]
python scripts/verity_cli.py evidence evidence.zip
```

---

## 6. Deploy on Render (free tier)

1. In Render, go to New, then Blueprint, and select this repo. Set the
   blueprint file path to `backend/render.yaml`. It defines one free web
   service with `rootDir: backend` and Python 3.11.9:
   - build command: `pip install -r requirements.txt`
   - start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1`
   - health check: `/health`
2. Fill in every `sync: false` variable in the dashboard: the keypairs, the
   Supabase keys, `FRONTEND_ORIGIN` (your Vercel URL) and the optional Pinata/AI keys.
3. Keep exactly one uvicorn worker. The background jobs run in-process with
   APScheduler, and Render's free tier has no separate worker service.
4. The free tier sleeps after 15 minutes idle. To keep it awake, point
   cron-job.org (or similar) at `GET /health` every 10 minutes.
5. Add the Render URL to the frontend env as `NEXT_PUBLIC_API_URL`, and add
   the Vercel domain to `FRONTEND_ORIGIN`.
