# Verity — Implementation Audit vs `Implementation_plan.md`

_Audit date: 2026-10-11 · Scope: programs, backend, frontend, DB, rule sets, zk, infra · Read-only audit, no code changed._

**Bottom line:** The core protocol is real and works end to end on devnet: the Anchor program, workers, browser verification and adversarial scenarios all run against the live chain, not mocks. The gaps are in the "Definition of done" layer: deployed URLs, README evidence, demo-page wiring and CI. There are also two serious security holes.

---

## 🔴 Fix first (security)

1. **Admin auth bypass (backend).**
   - `backend/app/auth.py:28` accepts the tokens `admin`, `dev-admin` and `dev-admin-token` as admin on every cluster, including mainnet.
   - Off mainnet, any token starting with `dev-` is accepted as admin.
   - `require_admin` (`auth.py:103-124`) makes every caller admin when the cluster is not mainnet: missing token, invalid token or a normal user all pass.
   - Result: `/admin/chaos`, `/admin/tamper`, `/admin/bootstrap`, `/admin/simulate` and `/admin/run/{job}` are open to the public on devnet.
2. **On-chain: a provider can win a dispute without evidence.**
   - `resolve_dispute` (`programs/verity_core/programs/verity_core/src/lib.rs:499-507`) can be called by anyone after the window ends, including the provider, with empty `remaining_accounts`.
   - The provider then wins and takes the challenger's stake, even when a quorum of mismatch attestations exists.
   - Fix: in the provider-wins branch, require `request.attest_count_mismatch < config.required_attestations`.
3. **Other on-chain issues:**
   - `finalize` ignores `attest_count_mismatch` (`lib.rs:536`).
   - A request in `AwaitingVerification` that never reaches quorum has no exit, because `expire_request` rejects it (`lib.rs:580`). The bounty and the provider's `active_jobs` stay locked, which also blocks unstaking.
   - Only one dispute per request is possible: the Dispute PDA is seeded by the request.
   - Slashing is capped at `min_provider_stake` (`lib.rs:483`).
   - `transfer_authority` is a single step, so a typo loses admin control.
   - `update_config` can change the window or quorum on requests already in flight.
4. **Other backend issues:**
   - `POST /requests/{pda}/reverify` (runs WASM on the server) and `/ai/explain-dispute` (spends LLM credits) require no login.
   - The audit-log hash covers `payload` only (`backend/app/audit.py:16`), so `event_type`, `actor` and `tx_sig` can be edited without breaking the chain.
   - The global exception handler returns `str(exc)` to clients (`backend/app/main.py:96`).
   - The SIWS message does not bind wallet, domain or issued_at (`routes/auth_wallet.py:61`).
   - CORS allows every `*.vercel.app` origin with credentials.

---

## ✅ Implemented

| Area | What exists |
|---|---|
| **verity_core program** | All 6 account types and both status enums. All 12 planned instructions plus 5 extras (`update_config`, `transfer_authority`, `register_verifier`, `set_verifier_active`, `unstake_provider`). All 9 planned events plus 7 extras. On-chain Ed25519 check by instruction introspection, with exact receipt bytes. Bounty and stake escrow, slashing, Clock-based challenge window, admin-only `anchor_audit_root`. Release profile set. Deployed; IDL identical across `idl/`, `frontend/src/idl` and `docs/blockchain/idl`. |
| **Engine** | wasmtime with fuel, linker with no imports, ABI check, program and input hash checks. Trace root `TRACE_V2` is a Merkle tree over input, checkpoints and output, which goes beyond the MVP. |
| **Chain client** | Real devnet transactions via solders and hand-written Borsh encoding (no anchorpy). The Ed25519 precompile instruction comes right before `submit_receipt`. |
| **Workers** | Provider (claim, run, sign, submit, upload, pin). Verifiers (any number of keypairs; compare output_hash, trace_root and fuel). Finalizer (opens disputes automatically; also finalize, resolve, expire). Indexer (events → DB → hash-chained audit_log → `anchor_audit_root` every 20 rows). APScheduler. |
| **API** | Every route in §6.3 plus extras (`/me`, `/stats`, `/config`, `/verifiers`, `/audit/verify`, `/requests/{pda}/trace` and `/zk`, plus admin bootstrap, simulate, run, scenarios). SIWS wallet link with PyNaCl and single-use nonces. Program registry with ABI validation, Storage upload and Pinata pinning. |
| **Adversarial** | Chaos flags `PROVIDER_TAMPER_OUTPUT`, `PROVIDER_SWAP_PROGRAM`, `STORAGE_TAMPER_INPUT`, `STORAGE_TAMPER_OUTPUT`, `PROVIDER_BAD_SIG` and `VERIFIER_LAZY` all change behaviour. `tests/test_adversarial.py` covers scenarios 1–8 against the live devnet API. |
| **Extras** | AI explainer (Claude → Groq → template fallback), Pinata IPFS, evidence zip, `backend/scripts/verity_cli.py` (`verify <pda>` and offline `evidence <zip>`). |
| **Database** | All 10 planned tables plus `wallet_nonces`, `indexer_state` and `input_commitments`. RLS: owner-only access to profiles and wallets; public read on transparency tables; writes by service role only. `auth.users → profiles` trigger. Append-only guard on audit_log. Realtime on requests, attestations, disputes, receipts and audit_log. Storage buckets `programs`, `inputs` and `outputs`. |
| **Rule sets** | payroll, loan_amortization, tax_india, stats_outliers, credit_risk, ml_inference. Built `.wasm` committed: 0 imports, exports `memory`/`alloc`/`compute`/`trace`, no floats. Shared `verity_abi` crate for canonical JSON. Every `meta.json` has input and output schemas. |
| **Frontend** | Google login plus wallet link (`WalletButton.tsx`). `create_request` and `open_dispute` are signed by the user's wallet on-chain (`lib/solana.ts`). `lib/verify.ts` in-browser verification goes beyond §8.3: program, input, output, trace-root and stored-blob checks. `/verify/[pda]` has QR, tamper banner, browser verify, ZK panel and evidence download. Also built: dashboard, `/rulesets`, `/activity`, `/provider` leaderboard, `/admin` chaos panel. |
| **ZK (stretch)** | circom + snarkjs Groth16 for payroll, verified on-chain by `verity_zk_verifier` (alt_bn128) and bound to the request PDA and program/input hashes. Proofs are generated in the browser. Deployed on devnet. |

---

## 🟡 Partial or deviating from the plan

- **`/requests/[pda]` (the main demo page) is thin.**
  - Missing: stepper, "Verify in my browser", receipt signature check, tamper banner, evidence download and explorer-linked timeline. `timeline` is fetched (`RequestDetailClient.tsx:46`) but never rendered.
  - The full set of features lives on `/verify/[pda]`.
  - Built but never mounted: `Timeline`, `ReceiptPanel`, `AttestationsTable`, `TraceAnalysisPanel`, and the AI-explainer `components/verify/DisputePanel.tsx`.
- **Landing `/` is still the Securio webflow template.**
  - It contains a Securio logo, "Trusted by 300+ companies" testimonials and Logoipsum client logos.
  - Nav links point to routes that don't exist: `/careers`, `/penetration-testing`, `/case-study`, …
  - It shows no live stats.
- **Hardcoded values in `/requests/[pda]`:** `windowSecs=120` and `minDisputeStake=5_000_000` (`RequestDetailClient.tsx:220,294`) instead of the on-chain config. When `submitted_at` is missing, the countdown resets on every poll.
- **ZK is advisory only.** There is no call into verity_core and no `finalize_with_proof`, so a proof never settles or slashes. Uses circom instead of SP1 / RISC Zero, and covers payroll only.
- **Requester-signed input commitment** is enforced only in `/requests/confirm`. `_has_valid_input_commitment` (`backend/app/workers/provider.py:154`) is never called.
- **Chaos flags** are kept in process memory. They are written to `chaos_flags` but never read back, so they reset on restart.
- **`audit_log.row_hash`** is computed in the backend, not by a DB trigger.
- **Dropped foreign keys:** `requests.program_hash` and `receipts`/`attestations.request_pda` have no foreign keys (intentional).
- **Anchor tests:** there is no `anchor test` suite. `scripts/smoke-test.mjs` (devnet) covers plan tests 1, 2 and 4, and part of 6.
- **Route renames:** `/requests/new` became `/create-job` and `/providers` became `/provider`. `/signup` duplicates `/login`.
- **Frontend stack deviations:** `@tanstack/react-query`, `@rjsf/core`, `react-hook-form` and `sonner` are not used. Next.js is 16, not 15.
- **Simulation side effect:** `backend/app/simulation.py` temporarily rewrites the global on-chain `challenge_window_secs`, which affects other live requests.

---

## ❌ Missing

**Definition of done**
- No deployed Vercel or Render URLs are recorded anywhere. Every live-deploy checkbox in `docs/tasks/TASK_5` is unchecked.
- Root `README.md` has no architecture diagram and no program ID.
- No explorer link is recorded for a verified request.
- The slashed request is recorded only as plain text in `docs/blockchain/deployment.md`.

**Tests**
- Not covered by smoke tests: plan test 3 (unstaked provider can't claim) and test 5 (finalize before window fails).
- Scenario 9 (zk) and the `ZK_CORRUPT_PROOF` flag don't exist.
- Locally, `pytest` gives 3 passed and 24 skipped:
  - the end-to-end tests need `VERITY_E2E=1` plus a live API
  - `test_engine_trace.py` skips because the rule sets aren't built where it expects them

**CI**
- The only workflow is `programs/verity_core/.github/workflows/build.yml`. GitHub ignores it because it isn't at the repo root.
- There is no CI for pytest or `next build`.

**Frontend**
- `tsc --noEmit` fails because `node_modules` is incomplete.
- Both `package-lock.json` and `pnpm-lock.yaml` are committed.
- Not built:
  - `/rulesets/new` (WASM upload)
  - Supabase Realtime in the UI (all polling)
  - auto-generated input form from `input_schema`
  - AI explainer in the UI

**Repo and tooling**
- `rulesets/build_all.sh` and the wasmtime-vs-browser determinism check don't exist.
- `scripts/deploy_program.py` and `deploy_program.sh` don't exist.
- No root `.env.example`.
- `REQUESTER_KEYPAIR_JSON` is not in `render.yaml`; it falls back to the admin key.

**Stale docs**
- `docs/tasks/README.md`: the progress numbers are out of date.
- `TASK_1`: says the migration is not applied.
- `TASK_6`: still describes SP1.

---

## Suggested order before the demo

1. Remove the auth bypasses in `backend/app/auth.py`.
2. Patch the `resolve_dispute` evidence check in `lib.rs` and redeploy the program.
3. Mount the existing verify components into `RequestDetailClient`, or point the demo flow at `/verify/[pda]`.
4. Strip the Securio template content from the landing page.
5. Reinstall frontend dependencies with one lockfile and confirm `next build` passes.
6. Deploy, then add the URLs, an architecture diagram and verified/slashed explorer links to the README.
7. Move CI to the root `.github/workflows/`, covering pytest and `next build`.
