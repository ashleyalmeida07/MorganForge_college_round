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
rulesets/                deterministic WASM rule sets (payroll, loan, tax, stats, risk, ml)
backend/                 FastAPI API + provider/verifier/finalizer workers — see backend/README.md
frontend/                Next.js app — see frontend/README.md
zk/                      Groth16 circuit + setup for the zk-verified payroll rule set
supabase/                SQL migrations (schema, RLS, hash-chained audit log)
```

## Run locally

1. `programs/verity_core` is already deployed to devnet — you don't need to redeploy it to run
   the app locally (see `DEPLOYMENT.md` for the program ID and keys).
2. Backend: follow [`backend/README.md`](backend/README.md) (env, Supabase migration, keypairs,
   chain bootstrap, rule-set seeding, `uvicorn app.main:app --reload`).
3. Frontend: follow [`frontend/README.md`](frontend/README.md) (`npm install && npm run dev`).

## Adversarial testing

Chaos flags (tampered output, swapped program, tampered blobs, forged signature, lazy verifier)
are toggled from `/admin` or `POST /admin/chaos` and exercised by `backend/tests/test_adversarial.py`
— see the table in `backend/README.md` §5.
