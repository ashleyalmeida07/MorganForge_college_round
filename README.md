# Verity

Verifiable computation for a new era of trust. **Prove the computation, not just the result.**

A Requester asks a Provider to run an agreed, deterministic program over an agreed input. The
Provider returns a result plus a signed, hash-committed execution receipt. Independent Verifiers
(and the Requester themself, in the browser) re-execute and attest on-chain. Disagreements go
through an on-chain dispute with stake slashing. Every request, receipt, attestation and dispute
is recorded on **Solana devnet**.

Full design: [`Implementation_plan.md`](Implementation_plan.md). Deployed program addresses and
smoke-test results: [`programs/verity_core/DEPLOYMENT.md`](programs/verity_core/DEPLOYMENT.md).

## Stack

Next.js (frontend) · FastAPI (backend, provider/verifier/finalizer workers) · Supabase
(Postgres + Auth, cache/index only) · Anchor program `verity_core` on Solana devnet · wasmtime
(deterministic WASM execution) · optional Groth16 zk verifier (`verity_zk_verifier`) for the
payroll rule set.

## Repo layout

```
programs/verity_core/   Anchor program (on-chain source of truth) + devnet deploy scripts
rulesets/                deterministic WASM rule sets (payroll, loan, tax, stats, risk, ml); build_all.sh
backend/                 FastAPI API + provider/verifier/finalizer workers — see backend/README.md
frontend/                Next.js app — see frontend/README.md
zk/                      Groth16 circuit + setup for the zk-verified payroll rule set
supabase/                SQL migrations (schema, RLS, hash-chained audit log)
scripts/                 deploy_program.sh|.py, seed_rulesets.py, verity_cli.py, apply_migrations.py
.github/workflows/ci.yml CI: pytest + Postgres, next build, rule-set determinism, program tests on a local validator
.env.example             every environment variable, grouped by where it is read
```

## Run locally

1. `programs/verity_core` is already deployed to devnet — you don't need to redeploy it to run
   the app locally (see `DEPLOYMENT.md` for the program ID and keys).
2. Backend: follow [`backend/README.md`](backend/README.md) (env, Supabase migration, keypairs,
   chain bootstrap, rule-set seeding, `uvicorn app.main:app --reload`).
3. Frontend: follow [`frontend/README.md`](frontend/README.md) (`npm install && npm run dev`).

## Adversarial testing

Chaos flags (tampered output, swapped program, tampered blobs, forged signature, lazy verifier,
corrupted zk proof) are toggled from `/admin` or `POST /admin/chaos`; "Run all scenarios" in `/admin`
runs the whole simulation lab on devnet. Scenarios 1–9 are tested at three levels:

- `backend/tests/test_adversarial_offline.py`: no network, every CI run
- `programs/verity_core/tests/verity_core.test.mjs` + `scripts/zk-smoke.mjs`: the programs on a local validator, every CI run
- `backend/tests/test_adversarial.py`: against a deployment + devnet (`VERITY_E2E=1`, or CI `workflow_dispatch`)

`rulesets/build_all.sh` rebuilds the rule sets and checks that wasmtime (backend) and V8 (browser)
produce identical outputs and traces. See the table in `backend/README.md` §5.
