# Verity — Implementation Plan

> **Prove the computation, not just the result.**
> A Solana-anchored verifiable-computation platform: a Requester asks a Provider to run an agreed, deterministic program over agreed inputs; the Provider returns a result plus a signed, hash-committed *execution receipt*; independent Verifiers (and the Requester themself, in the browser) re-execute and attest; disagreements go through an on-chain dispute with stake slashing. Every request, result, attestation and dispute is recorded immutably on Solana devnet.

**Stack:** Next.js (Vercel) · FastAPI (Render) · Supabase Postgres + Google Auth · Rust/Anchor program on Solana devnet
**Timebox:** 30 hours · **Target:** working end-to-end demo + adversarial demo + deployed URLs

---

## Table of Contents

1. [Core idea & verification model](#1-core-idea--verification-model)
2. [System architecture](#2-system-architecture)
3. [End-to-end flow](#3-end-to-end-flow)
4. [Feature list (MVP → Stretch)](#4-feature-list)
5. [Blockchain layer — Solana programs](#5-blockchain-layer--solana-programs)
6. [Backend — FastAPI](#6-backend--fastapi)
7. [Database — Supabase](#7-database--supabase)
8. [Frontend — Next.js](#8-frontend--nextjs)
9. [Compute engine & "rule sets" (what gets computed)](#9-compute-engine--rule-sets)
10. [Adversarial testing scenarios (demo script)](#10-adversarial-testing-scenarios)
11. [Free tools, APIs, models & integrations](#11-free-tools-apis-models--integrations)
12. [Repo layout](#12-repo-layout)
13. [30-hour schedule & team split](#13-30-hour-schedule--team-split)
14. [Deployment guide (Vercel + Render + Supabase + Solana devnet)](#14-deployment-guide)
15. [Deploying Solana programs directly (the "web3.py to Sepolia" equivalent)](#15-deploying-solana-programs-directly)
16. [Demo script & judging pitch](#16-demo-script--judging-pitch)
17. [Risks & fallbacks](#17-risks--fallbacks)

---

## 1. Core idea & verification model

### The problem in one line
A Requester cannot tell whether a Provider actually ran the agreed computation on the agreed input, unless they re-run everything themselves.

### Verity's answer: *commit → execute → receipt → independent re-execution → dispute*

Verity uses **deterministic sandboxed execution + cryptographic commitments + optimistic verification with staking**, with **zero-knowledge proofs as an optional stretch layer**. This is the same family of ideas as Arbitrum/Optimism fraud proofs and Truebit, scaled down to something buildable in 30 hours.

| Layer | What it guarantees | How |
|---|---|---|
| **Agreement** | Both parties agree on *exactly* what will run and on what data | `program_hash = SHA-256(wasm bytes)`, `input_hash = SHA-256(canonical JSON input)`; both stored on-chain in the request |
| **Determinism** | The same (program, input) always yields the same output on any machine | Programs are **WebAssembly** modules executed in **wasmtime** with no I/O, no clock, no randomness, fixed fuel limit |
| **Receipt** | Provider commits to a result and cannot change it later | Provider signs `receipt = {request_id, program_hash, input_hash, output_hash, trace_root, fuel_used}` with its Solana keypair (Ed25519); `output_hash` + `trace_root` + signature go on-chain |
| **Independent verification** | Anyone can check the result without trusting the Provider | Verifier nodes re-execute and submit on-chain attestations; **the Requester can also re-execute in the browser** (same WASM, same input) and compare hashes locally |
| **Tamper evidence** | Nobody (incl. the platform backend) can silently alter inputs/outputs | Every artifact is content-addressed; chain holds hashes; DB holds blobs; UI re-hashes blobs on load and flags mismatches |
| **Dispute resolution** | Wrong results are caught and punished | Challenger stakes SOL and posts a conflicting `output_hash`; verifier quorum (or arbiter re-execution) resolves; loser's stake is slashed to the winner |
| **Traceability** | Full history for audit | Anchor events + account state on-chain; `audit_log` table off-chain; timeline UI links each step to a Solana Explorer tx |
| **(Stretch) Proof of execution** | Verification *without* re-execution | SP1 / RISC Zero zkVM proof generated offline, Groth16 proof verified on-chain via `sp1-solana` verifier |

**Why this wins judging points:** it hits every bullet in the problem statement (verifiable computation, independent verification, tamper-evident records, input/output integrity, dispute resolution, adversarial testing, execution traceability), it is actually demonstrable live, and the "verify in your own browser" feature gives a visceral "I don't have to trust anyone" moment.

### Terminology (use consistently across code, UI and pitch)
- **Rule Set / Program** — a deterministic WASM module (and its source) that defines the computation.
- **Request** — on-chain account: who wants what computed over which input, with bounty and deadline.
- **Receipt** — the Provider's signed commitment to the result (output hash + trace root + fuel used).
- **Attestation** — a Verifier's on-chain vote: "I re-executed and got hash X".
- **Dispute** — a staked challenge against a Receipt.
- **Finalization** — the request reaches `Verified` or `Rejected` after the challenge window.

---

## 2. System architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                               Next.js (Vercel)                               │
│  Google login (Supabase Auth) · Phantom wallet · Request builder · Timeline  │
│  In-browser WASM re-execution (WebAssembly API) · Dispute UI · Explorer links│
└───────────────┬─────────────────────────────┬────────────────────────────────┘
                │ REST/JSON (JWT)             │ Solana RPC (wallet-signed txs)
                ▼                             ▼
┌───────────────────────────────┐   ┌────────────────────────────────────────┐
│       FastAPI (Render)        │   │        Solana devnet (Helius RPC)       │
│  /requests /results /verify   │◄─►│  verity_core program (Anchor, Rust)     │
│  Provider worker (wasmtime)   │   │  Accounts: Config, Provider, Request,   │
│  Verifier workers (wasmtime)  │   │  Receipt, Attestation, Dispute          │
│  Chain indexer (event poller) │   │  Events: RequestCreated, ReceiptPosted, │
│  Receipt signer (Ed25519)     │   │  Attested, DisputeOpened, Finalized     │
└───────────────┬───────────────┘   └────────────────────────────────────────┘
                │ supabase-py (service role)
                ▼
┌───────────────────────────────┐
│    Supabase (Postgres+Auth)   │
│  users · wallets · programs   │
│  requests · receipts          │
│  attestations · disputes      │
│  audit_log · Storage (blobs)  │
└───────────────────────────────┘
```

**Design rules**
1. **Chain is the source of truth for commitments and state transitions.** DB is a cache/index + blob store. The UI shows "on-chain" badges with tx links.
2. **Hashes on-chain, blobs off-chain.** Inputs/outputs/WASM live in Supabase Storage (optionally pinned to IPFS). Anything loaded from storage is re-hashed client-side and compared with the chain.
3. **Provider and Verifiers are separate keypairs** (even if they run in the same Render process for the demo) so slashing/attestation logic is real.
4. **Everything deterministic.** Canonical JSON (sorted keys, no whitespace, UTF-8) for inputs/outputs; WASM with fuel metering; no floats in rule sets where avoidable (use integers/fixed-point) to guarantee bit-identical output across machines and browsers.

---

## 3. End-to-end flow

### 3.1 Happy path (Requester → Provider → Verifiers → Finalized)

```
Requester (browser)          Backend (FastAPI)              Solana (verity_core)          Verifiers
      │                            │                               │                          │
 1.   │ Google login ──────────────►│ Supabase JWT                  │                          │
 2.   │ Connect Phantom, sign SIWS ►│ link wallet ↔ user            │                          │
 3.   │ Pick rule set + upload input│                               │                          │
      │ ───────────────────────────►│ canonicalize, hash, store blob│                          │
      │ ◄── {program_hash,input_hash,input_uri}                     │                          │
 4.   │ wallet.signAndSend(create_request) ───────────────────────► │ Request PDA created      │
      │                            │◄── indexer sees RequestCreated │ (status=Open, bounty esc)│
 5.   │                            │ Provider worker claims job     │                          │
      │                            │ ─ claim_request ─────────────► │ status=Claimed           │
 6.   │                            │ run WASM in wasmtime           │                          │
      │                            │ output, trace_root, fuel       │                          │
      │                            │ sign receipt (Ed25519)         │                          │
      │                            │ ─ submit_receipt ────────────► │ Receipt PDA, status=     │
      │                            │                               │  AwaitingVerification    │
 7.   │                            │ notify verifiers ─────────────────────────────────────── ►│ re-execute
      │                            │                               │ ◄─── attest(output_hash) │ (N workers)
 8.   │ "Verify in my browser" ────│ fetch wasm+input, run locally,│                          │
      │  compare hash locally      │                               │                          │
 9.   │                            │ after challenge window / quorum│                          │
      │                            │ ─ finalize ──────────────────► │ status=Verified, bounty  │
      │                            │                               │  paid to provider        │
10.   │ Timeline shows every step with tx signature + explorer link │                          │
```

### 3.2 Dispute path (adversarial)

```
 6'.  Malicious provider submits receipt with tampered output_hash
 7'.  Verifiers re-execute → their hash ≠ provider hash → attest(mismatch)
 8'.  Any party (verifier, requester, or bot) calls open_dispute(stake, claimed_hash)
 9'.  Resolution (MVP): verifier quorum ≥ 2/3 agree on claimed_hash → resolve_dispute
      Resolution (stretch): arbiter re-executes deterministically / zk proof decides
10'.  Provider stake slashed → paid to challenger + verifiers; status=Rejected; event emitted
11'.  Request may be re-opened for another provider
```

### 3.3 Integrity checks that happen *everywhere*
- Backend recomputes `input_hash` before storing and refuses mismatch.
- Program re-hashes WASM? No — chain stores `program_hash`; Provider/Verifiers/Browser **must** fetch WASM, hash it, and abort if it ≠ chain value. (This catches a swapped program.)
- `output_hash` on-chain vs stored output blob re-hashed in UI → "Tampered output blob" banner if different.
- Receipt signature verified both on-chain (Ed25519 program instruction introspection) and in backend (PyNaCl).

---

## 4. Feature list

Legend: **[MVP]** must ship · **[Plus]** ship if on schedule · **[Stretch]** standout if time remains

### 4.1 Verifiable Computation
- **[MVP] Deterministic WASM rule sets** executed in wasmtime (backend) and WebAssembly API (browser) with identical results.
- **[MVP] Content-addressed commitments** for program, input, output (SHA-256).
- **[MVP] Signed execution receipt** (Ed25519 by Provider keypair) stored on-chain.
- **[Plus] Execution trace Merkle root** — hash of ordered host-call/checkpoint log (e.g., every 10k fuel units, snapshot memory hash). Lets a challenger point at the *first divergent step*.
- **[Stretch] zkVM proof** — compile the rule set as an SP1/RISC Zero guest; prove offline on a laptop; verify Groth16 on-chain through `sp1-solana`. Demo one rule set this way.

### 4.2 Independent Verification
- **[MVP] Verifier worker pool** (N=3 keypairs) that re-executes and attests on-chain.
- **[MVP] "Verify in my browser"** — Requester re-runs the WASM locally in the browser and compares hashes; shows green/red with no backend trust.
- **[Plus] `verity-cli verify <request_pda>`** — a tiny Python CLI script anyone can run offline against devnet + storage.
- **[Plus] Public verification page** (`/verify/[requestPda]`, no login) + QR code.

### 4.3 Tamper-Evident Records
- **[MVP] On-chain accounts** for Request, Receipt, Attestation, Dispute with Anchor events.
- **[MVP] Append-only `audit_log` table** with hash-chained rows (`row_hash = sha256(prev_hash || payload)`) and periodic anchoring of the latest `row_hash` on-chain (`anchor_audit_root` instruction) — tamper evidence for the off-chain DB too.
- **[Plus] IPFS pinning** of inputs/outputs/WASM via Pinata or Lighthouse free tier (CID stored alongside hash).

### 4.4 Input and Output Integrity
- **[MVP] Canonical JSON** (RFC 8785-style) + hashing in frontend *and* backend; mismatch → reject.
- **[MVP] UI re-hashing** of every blob on display with "matches chain ✅ / TAMPERED ❌".
- **[Plus] Requester-signed input commitment** (wallet signs `input_hash`) so the Provider can prove what it was asked to run.

### 4.5 Dispute Resolution
- **[MVP] Staked disputes**: `open_dispute` (challenger stakes), `resolve_dispute` (quorum of verifier attestations), slashing to winner.
- **[Plus] Challenge window** with timestamps enforced on-chain (`Clock` sysvar); auto-finalize bot.
- **[Stretch] Bisection on trace**: challenger submits step index; arbiter re-executes to that checkpoint; on-chain compares the two memory hashes.

### 4.6 Adversarial Testing
- **[MVP] "Chaos toggles"** in an admin panel: Malicious Provider (tamper output), Swapped Program, Tampered Input Blob, Forged Signature, Lazy Verifier (copies provider hash without executing — detected by requiring verifiers to also submit `fuel_used` + trace root).
- **[MVP] Scripted adversarial test suite** (`pytest`) that runs each scenario against devnet and asserts detection.

### 4.7 Execution Traceability
- **[MVP] Timeline view** per request: created → claimed → receipt → attestations → dispute → finalized, each with tx signature, slot, timestamp, explorer link.
- **[Plus] Global activity feed** + provider reputation (success count, slash count) from on-chain Provider accounts.
- **[Plus] Export "evidence bundle"** (zip: wasm, input, output, receipt JSON, chain tx list) for offline audit.

### 4.8 UX / "Wow" extras
- **[Plus] Rule-set marketplace** with 5–6 prebuilt templates (payroll, loan interest, tax, statistics, risk score, tiny ML inference).
- **[Plus] AI explainer** (free LLM API) that turns dispute evidence into a plain-English summary ("Provider's output differs at field `net_pay`; verifiers unanimously computed 4,210 vs claimed 5,210").
- **[Stretch] Rule-set compiler in the browser**: write Rust/AssemblyScript → compile → hash → register. (AssemblyScript compiles in-browser; Rust does not — use a backend `cargo build --target wasm32-unknown-unknown` endpoint instead.)

---

## 5. Blockchain layer — Solana programs

### 5.1 How many programs?

**Answer: 1 mandatory program + 1 optional.**

| # | Program | Purpose | Status |
|---|---|---|---|
| 1 | `verity_core` | Everything: registry/config, provider staking, requests, receipts, attestations, disputes, finalization, audit-root anchoring, bounty escrow | **MVP** |
| 2 | `verity_zk_verifier` | Verifies SP1 Groth16 proofs for a rule set and calls back into `verity_core` (CPI) to mark the request `Verified` without re-execution | Stretch |

On Solana, one program can hold many account types and instructions, so splitting into multiple programs buys you nothing in 30 hours except CPI headaches. If judges ask "why one contract?", the answer is: *Solana programs are stateless executors; state lives in PDAs; modularity comes from account types, not from deploying N programs.*

### 5.2 Toolchain choice: Anchor (recommended) vs native Rust

- **Anchor** gives you account validation, serialization, PDAs, events, an **IDL** (the frontend/backend clients are generated from it), and a test runner. Use it.
- Native `solana-program` Rust is possible (and shown in §15 for deployment) but you will spend 5+ hours writing what Anchor gives you free.
- Deployment does **not** require Anchor's CLI; see §15.

### 5.3 Account model (PDAs)

```rust
// seeds: ["config"]
pub struct Config {
    pub authority: Pubkey,          // admin (can set params, anchor audit roots)
    pub min_provider_stake: u64,    // lamports
    pub min_dispute_stake: u64,
    pub challenge_window_secs: i64, // e.g. 120s for demo, configurable
    pub required_attestations: u8,  // quorum size, e.g. 2
    pub request_count: u64,
    pub latest_audit_root: [u8; 32],
    pub bump: u8,
}

// seeds: ["provider", provider_pubkey]
pub struct Provider {
    pub owner: Pubkey,
    pub stake: u64,
    pub completed: u32,
    pub slashed: u32,
    pub active: bool,
    pub bump: u8,
}

// seeds: ["request", requester_pubkey, request_index_le]
pub struct Request {
    pub id: u64,
    pub requester: Pubkey,
    pub program_hash: [u8; 32],
    pub input_hash: [u8; 32],
    pub input_uri_hash: [u8; 32],   // hash of the storage URI/CID, keeps acct small
    pub bounty: u64,                // lamports escrowed in the PDA
    pub deadline: i64,
    pub status: RequestStatus,      // Open | Claimed | AwaitingVerification | Disputed | Verified | Rejected | Expired
    pub provider: Option<Pubkey>,
    pub created_at: i64,
    pub receipt_at: i64,
    pub attest_count_match: u8,
    pub attest_count_mismatch: u8,
    pub bump: u8,
}

// seeds: ["receipt", request_pda]
pub struct Receipt {
    pub request: Pubkey,
    pub provider: Pubkey,
    pub output_hash: [u8; 32],
    pub trace_root: [u8; 32],
    pub fuel_used: u64,
    pub signature: [u8; 64],        // Ed25519 over canonical receipt bytes
    pub submitted_at: i64,
    pub bump: u8,
}

// seeds: ["attestation", request_pda, verifier_pubkey]
pub struct Attestation {
    pub request: Pubkey,
    pub verifier: Pubkey,
    pub output_hash: [u8; 32],
    pub trace_root: [u8; 32],
    pub fuel_used: u64,
    pub matches: bool,
    pub attested_at: i64,
    pub bump: u8,
}

// seeds: ["dispute", request_pda]
pub struct Dispute {
    pub request: Pubkey,
    pub challenger: Pubkey,
    pub stake: u64,
    pub claimed_output_hash: [u8; 32],
    pub status: DisputeStatus,      // Open | ChallengerWon | ProviderWon
    pub opened_at: i64,
    pub resolved_at: i64,
    pub bump: u8,
}
```

### 5.4 Instructions (≈12)

| Instruction | Signer | Effect | Emits |
|---|---|---|---|
| `initialize(params)` | admin | Create `Config` | `Initialized` |
| `register_provider()` + `stake_provider(lamports)` | provider | Create/stake `Provider` | `ProviderStaked` |
| `create_request(program_hash, input_hash, input_uri_hash, bounty, deadline)` | requester | Create `Request`, transfer bounty into PDA | `RequestCreated` |
| `claim_request()` | provider | `Open → Claimed`; requires `Provider.stake ≥ min` | `RequestClaimed` |
| `submit_receipt(output_hash, trace_root, fuel_used, sig)` | provider | Create `Receipt`; verify Ed25519 via **Ed25519 precompile instruction introspection** (`sysvar::instructions`); `Claimed → AwaitingVerification` | `ReceiptSubmitted` |
| `attest(output_hash, trace_root, fuel_used)` | verifier | Create `Attestation`; compare to Receipt; bump match/mismatch counters | `Attested` |
| `open_dispute(claimed_output_hash)` | anyone | Create `Dispute`, escrow stake; `→ Disputed` | `DisputeOpened` |
| `resolve_dispute()` | anyone (permissionless) | If mismatch attestations ≥ quorum and they agree with `claimed_output_hash` → challenger wins: slash provider stake → challenger + verifiers, `→ Rejected`. Else provider wins: challenger stake → provider, `→ AwaitingVerification` | `DisputeResolved` |
| `finalize()` | anyone | After challenge window and match attestations ≥ quorum and no open dispute: pay bounty to provider, `→ Verified`, `Provider.completed++` | `Finalized` |
| `expire_request()` | anyone | After deadline with no receipt: refund bounty, `→ Expired` | `Expired` |
| `anchor_audit_root(root)` | admin | Write latest DB audit-log hash into `Config` | `AuditRootAnchored` |
| `verify_zk_proof(proof, public_inputs)` *(stretch, program 2)* | anyone | Verify Groth16; CPI `finalize_with_proof` | `ZkVerified` |

**Ed25519 signature check on-chain (how):** the client sends a transaction with two instructions: `[Ed25519Program.verify(pubkey, msg, sig), verity_core.submit_receipt(...)]`. Inside `submit_receipt`, load `sysvar::instructions`, fetch instruction 0, assert it targets the Ed25519 program and that its data contains the provider pubkey + the exact receipt message bytes. Anchor pattern is well documented ("ed25519 instruction introspection").

**Receipt message bytes (canonical):**
`b"VERITY_RECEIPT_V1" || request_pda(32) || program_hash(32) || input_hash(32) || output_hash(32) || trace_root(32) || fuel_used(u64 LE)`

### 5.5 Events (Anchor `#[event]`)
`RequestCreated{id, requester, program_hash, input_hash, bounty}`, `RequestClaimed`, `ReceiptSubmitted{request, provider, output_hash, trace_root}`, `Attested{request, verifier, matches}`, `DisputeOpened`, `DisputeResolved{winner}`, `Finalized`, `Expired`, `AuditRootAnchored`. The backend indexer parses them from `getSignaturesForAddress` + `getTransaction` logs (Anchor `EventParser`) — or subscribes via Helius webhooks (free tier).

### 5.6 Anchor tests (write 6, run on `solana-test-validator`)
1. happy path to `Verified`; 2. tampered receipt → mismatch attestations → dispute → `Rejected` + slash; 3. unstaked provider cannot claim; 4. forged signature rejected; 5. finalize before window fails; 6. expire refunds bounty.

### 5.7 Program sizing / cost on devnet
- Anchor program ≈ 250–400 KB → rent-exempt deposit ≈ 2–3 SOL. Devnet airdrop gives up to 5 SOL/request (rate-limited; use `https://faucet.solana.com` too). Get **≥ 8 SOL** on the deployer wallet early.
- Build with `--release` and `[profile.release] overflow-checks = true, lto = "fat", codegen-units = 1` to shrink.

---

## 6. Backend — FastAPI

### 6.1 Responsibilities
1. **Auth**: validate Supabase JWT (Google) on every route; link wallet via Sign-In-With-Solana (nonce → wallet signs → verify with PyNaCl → store).
2. **Rule-set registry**: upload WASM (+ source), compute hash, store in Supabase Storage, insert `programs` row.
3. **Request prep**: canonicalize input JSON, hash, upload, return hashes + URI; frontend then sends the on-chain tx from the wallet. (Backend never custodies the requester's key.)
4. **Provider worker** (background task / APScheduler): poll chain/DB for `Open` requests → `claim_request` → download WASM + input → verify hashes → run wasmtime → produce output, trace root, fuel → sign receipt → `submit_receipt` → upload output blob.
5. **Verifier workers** (3 keypairs): on `ReceiptSubmitted` → independently re-execute → `attest`.
6. **Finalizer bot**: periodically call `finalize` / `expire_request` / `resolve_dispute` when conditions are met (all permissionless).
7. **Chain indexer**: poll events → upsert DB → append `audit_log` (hash-chained) → every N rows call `anchor_audit_root`.
8. **Chaos endpoints** (admin only): set flags that make the provider/verifier misbehave for the adversarial demo.
9. **AI explainer** (optional): summarise a dispute using a free LLM API.

### 6.2 Key libraries (all free/OSS)
- `fastapi`, `uvicorn`, `pydantic`, `httpx`
- `solana` (solana-py) + `solders` — RPC, keypairs, tx building
- `anchorpy` — generate a typed Python client from the Anchor IDL (`anchorpy client-gen idl.json ./verity_client`) so instruction calls are one-liners
- `wasmtime` (wasmtime-py) — deterministic WASM execution with fuel metering
- `pynacl` — Ed25519 sign/verify
- `supabase` (supabase-py) — DB + Storage with service-role key
- `pyjwt` — verify Supabase JWT (HS256 with project JWT secret or JWKS)
- `apscheduler` — background jobs (Render free = single process; fine)
- `canonicaljson` or a 10-line custom canonicalizer (`json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`)

### 6.3 API surface

```
POST /auth/wallet/nonce            → {nonce}
POST /auth/wallet/link             {wallet, signature} → links wallet to user
GET  /programs                      → list rule sets (hash, name, description, abi)
POST /programs                      multipart: wasm, source, metadata → {program_hash, uri}
POST /requests/prepare              {program_hash, input} → {input_hash, input_uri, canonical_input}
POST /requests/confirm              {request_pda, tx_sig} → upsert DB row after on-chain creation
GET  /requests?mine|all&status=     → list
GET  /requests/{pda}                → full detail + timeline (merged chain + DB)
GET  /requests/{pda}/artifacts      → signed URLs for wasm/input/output + hashes
GET  /requests/{pda}/evidence.zip   → evidence bundle
POST /disputes/prepare              {request_pda, claimed_output_hash} → data for wallet tx
GET  /providers                     → reputation table
GET  /activity                      → global feed
POST /admin/chaos                   {flag, enabled}   (admin only)
POST /ai/explain-dispute            {request_pda} → text
GET  /health
```

### 6.4 Execution engine (`engine/runner.py`)

```python
from wasmtime import Config, Engine, Store, Module, Linker, Instance, Memory
import hashlib, json

FUEL_LIMIT = 50_000_000

def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()

def sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()

def run(wasm_bytes: bytes, input_json: dict, expected_program_hash: bytes):
    assert sha256(wasm_bytes) == expected_program_hash, "program hash mismatch"
    cfg = Config(); cfg.consume_fuel = True
    engine = Engine(cfg); store = Store(engine); store.set_fuel(FUEL_LIMIT)
    module = Module(engine, wasm_bytes)
    linker = Linker(engine)            # NO WASI, NO host imports → fully deterministic
    inst = linker.instantiate(store, module)
    mem: Memory = inst.exports(store)["memory"]
    alloc = inst.exports(store)["alloc"]; compute = inst.exports(store)["compute"]
    inp = canonical(input_json)
    ptr = alloc(store, len(inp)); mem.write(store, inp, ptr)
    out_ptr = compute(store, ptr, len(inp))         # returns ptr to [len:u32][bytes]
    out_len = int.from_bytes(mem.read(store, out_ptr, out_ptr + 4), "little")
    out = bytes(mem.read(store, out_ptr + 4, out_ptr + 4 + out_len))
    fuel_used = FUEL_LIMIT - store.get_fuel()
    trace_root = sha256(b"TRACE_V1" + sha256(inp) + sha256(out) + fuel_used.to_bytes(8, "little"))
    return {"output": json.loads(out), "output_hash": sha256(out), "trace_root": trace_root, "fuel_used": fuel_used}
```

> Trace root MVP = hash of (input hash, output hash, fuel). **Plus** version: wrap `compute` in checkpoints (export `step(n)`), hashing linear memory every K steps and building a Merkle tree over those hashes — that is what makes bisection disputes possible later.

**Exact same ABI in the browser** (`WebAssembly.instantiate` + `TextEncoder` + Web Crypto `crypto.subtle.digest("SHA-256")`). Browser cannot meter fuel, so the browser comparison is on `output_hash` only; verifiers compare fuel too.

### 6.5 Receipt signing

```python
from nacl.signing import SigningKey
def receipt_msg(request_pda: bytes, ph, ih, oh, tr, fuel: int) -> bytes:
    return b"VERITY_RECEIPT_V1" + request_pda + ph + ih + oh + tr + fuel.to_bytes(8, "little")
sig = SigningKey(provider_keypair.secret()[:32]).sign(msg).signature  # 64 bytes
```
Then build tx: `[ed25519_program.new_ed25519_instruction(...), verity.submit_receipt(...)]` via `solders`/`anchorpy`.

---

## 7. Database — Supabase

### 7.1 Tables

```sql
-- users come from auth.users (Google). Profile mirror:
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  email text, display_name text, avatar_url text,
  role text default 'user' check (role in ('user','admin')),
  created_at timestamptz default now()
);

create table wallets (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade,
  pubkey text unique not null,
  verified_at timestamptz default now()
);

create table programs (                      -- rule sets
  program_hash text primary key,             -- hex sha256 of wasm
  name text not null, description text,
  version text, language text,               -- rust | assemblyscript
  input_schema jsonb, output_schema jsonb,   -- JSON Schema for the UI form
  wasm_uri text not null, source_uri text, ipfs_cid text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table providers (
  pubkey text primary key,
  user_id uuid references profiles(id),
  name text, stake_lamports bigint default 0,
  completed int default 0, slashed int default 0, active bool default true,
  last_synced_slot bigint
);

create table requests (
  request_pda text primary key,
  onchain_id bigint, requester_pubkey text not null, requester_user uuid references profiles(id),
  program_hash text references programs(program_hash),
  input_hash text not null, input_uri text not null, input_ipfs_cid text,
  bounty_lamports bigint, deadline timestamptz,
  status text not null,            -- mirrors chain enum
  provider_pubkey text, create_tx text, created_slot bigint,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table receipts (
  request_pda text primary key references requests(request_pda),
  provider_pubkey text, output_hash text, trace_root text, fuel_used bigint,
  signature text, output_uri text, output_ipfs_cid text,
  tx_sig text, slot bigint, submitted_at timestamptz
);

create table attestations (
  id bigint generated always as identity primary key,
  request_pda text references requests(request_pda),
  verifier_pubkey text, output_hash text, trace_root text, fuel_used bigint,
  matches bool, tx_sig text, slot bigint, attested_at timestamptz,
  unique (request_pda, verifier_pubkey)
);

create table disputes (
  request_pda text primary key references requests(request_pda),
  challenger_pubkey text, stake_lamports bigint, claimed_output_hash text,
  status text, open_tx text, resolve_tx text, opened_at timestamptz, resolved_at timestamptz,
  ai_explanation text
);

create table audit_log (                     -- append-only, hash-chained
  seq bigint generated always as identity primary key,
  event_type text not null, request_pda text, actor text,
  payload jsonb not null, tx_sig text, slot bigint,
  prev_hash text not null, row_hash text not null,
  anchored_tx text,                          -- set when root anchored on-chain
  created_at timestamptz default now()
);

create table chaos_flags (name text primary key, enabled bool default false, updated_at timestamptz);
```

### 7.2 Policies & triggers
- **RLS**: `profiles`/`wallets` readable/writable by owner; `requests`, `receipts`, `attestations`, `disputes`, `programs`, `audit_log` **publicly readable** (transparency is the point); writes only by service role (backend).
- Trigger `on auth.users insert → insert profiles`.
- `audit_log` has `revoke update, delete on audit_log from anon, authenticated;` and a trigger that computes `row_hash = encode(sha256((prev_hash || payload::text)::bytea), 'hex')` — DB-level tamper evidence, anchored on-chain by the backend.
- Supabase **Realtime** on `requests`/`attestations` → live timeline updates in the UI with zero polling code.
- **Storage buckets**: `programs` (public read), `inputs` (public read — or private + signed URLs if inputs are "sensitive"; for the demo use public + note that Verity supports private inputs since only hashes go on-chain), `outputs`.

---

## 8. Frontend — Next.js

### 8.1 Stack
Next.js 15 (App Router, TypeScript) · Tailwind + **shadcn/ui** · `@supabase/ssr` (Google OAuth) · `@solana/wallet-adapter-react` + Phantom/Solflare · `@coral-xyz/anchor` (IDL → typed client) · `@tanstack/react-query` · `recharts` (activity charts) · `lucide-react` icons · `react-hook-form` + `@rjsf/core` (auto-form from `input_schema`) · `qrcode.react` · `sonner` toasts.

### 8.2 Pages

| Route | Purpose |
|---|---|
| `/` | Landing: what Verity is, live stats (requests, verified %, disputes caught), "Try demo" |
| `/login` | Google (Supabase) → then wallet connect + SIWS link |
| `/dashboard` | My requests, my provider stats, quick actions |
| `/rulesets` | Rule-set marketplace (cards: name, hash, schema, source link, "Use") |
| `/rulesets/new` | Upload WASM + source + schemas → registers (hash computed in browser *and* backend; must match) |
| `/requests/new` | Pick rule set → auto-generated input form → preview canonical JSON + hash → set bounty/deadline → sign `create_request` with Phantom |
| `/requests/[pda]` | **The hero page**: status stepper, artifacts with integrity badges, receipt + signature check, attestations table, "Verify in my browser" button, dispute panel, timeline with explorer links, evidence download |
| `/verify/[pda]` | Public, no-login verification page + QR |
| `/providers` | Reputation leaderboard |
| `/activity` | Global feed from `audit_log` + chain events |
| `/admin` | Chaos toggles + "run adversarial suite" button + config |

### 8.3 In-browser verification (`lib/verify.ts`)

```ts
export async function verifyLocally(wasmUrl: string, inputUrl: string, chain: {programHash: string; inputHash: string; outputHash: string}) {
  const wasm = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
  const input = await (await fetch(inputUrl)).text();            // already canonical
  if (hex(await sha256(wasm)) !== chain.programHash) return { ok:false, reason:"PROGRAM_TAMPERED" };
  if (hex(await sha256(enc(input))) !== chain.inputHash) return { ok:false, reason:"INPUT_TAMPERED" };
  const { instance } = await WebAssembly.instantiate(wasm, {});   // no imports → deterministic
  const { memory, alloc, compute } = instance.exports as any;
  const inBytes = enc(input); const ptr = alloc(inBytes.length);
  new Uint8Array(memory.buffer).set(inBytes, ptr);
  const outPtr = compute(ptr, inBytes.length);
  const view = new DataView(memory.buffer); const len = view.getUint32(outPtr, true);
  const out = new Uint8Array(memory.buffer, outPtr + 4, len);
  const myHash = hex(await sha256(out));
  return { ok: myHash === chain.outputHash, myHash, output: JSON.parse(dec(out)) };
}
```

### 8.4 Wallet transactions from the browser
Use the Anchor IDL (`target/idl/verity_core.json` committed to `frontend/src/idl/`):
```ts
const program = new Program<VerityCore>(idl, { connection, wallet });
await program.methods.createRequest([...programHash], [...inputHash], [...uriHash], new BN(bounty), new BN(deadline))
  .accounts({ requester: wallet.publicKey, config, request: requestPda, systemProgram })
  .rpc();
```
Disputes are also signed by the user's wallet; everything else (claim, receipt, attest, finalize) is backend keypairs.

---

## 9. Compute engine & rule sets

### 9.1 Rule-set ABI (contract between everything)
Exports: `memory`, `alloc(len:i32)->i32`, `compute(ptr:i32,len:i32)->i32` (returns pointer to `u32 len || bytes` of canonical-JSON output). No imports. No floats unless unavoidable (WASM floats are deterministic for basic ops, but JSON float formatting is not — emit integers/fixed-point strings).

### 9.2 Rust template (`rulesets/template/src/lib.rs`)
```rust
use serde::{Deserialize, Serialize};
#[derive(Deserialize)] struct Input { salary_cents: u64, tax_bps: u32, deductions_cents: u64 }
#[derive(Serialize)]   struct Output { gross_cents: u64, tax_cents: u64, net_cents: u64 }

fn rule(i: Input) -> Output {
    let tax = i.salary_cents * i.tax_bps as u64 / 10_000;
    Output { gross_cents: i.salary_cents, tax_cents: tax, net_cents: i.salary_cents - tax - i.deductions_cents }
}

#[no_mangle] pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::with_capacity(len); let p = v.as_mut_ptr(); std::mem::forget(v); p }
#[no_mangle] pub extern "C" fn compute(ptr: *const u8, len: usize) -> *const u8 {
    let input: Input = serde_json::from_slice(unsafe { std::slice::from_raw_parts(ptr, len) }).unwrap();
    let mut out = canonical_json(&rule(input));            // sorted keys, compact
    let mut buf = (out.len() as u32).to_le_bytes().to_vec(); buf.append(&mut out);
    let p = buf.as_ptr(); std::mem::forget(buf); p }
```
Build: `cargo build --release --target wasm32-unknown-unknown` → `target/wasm32-unknown-unknown/release/payroll.wasm` (~50–100 KB; run `wasm-opt -Oz` from Binaryen if you want it smaller). Use `serde_json` with `preserve_order` **off** and a small sort-keys helper (serialize to `serde_json::Value`, then recursively sort maps into `BTreeMap`) to get canonical output.

### 9.3 Prebuilt rule sets to ship (pick 4–6)
1. **Payroll / net pay** (above) — simple, relatable.
2. **Loan amortization schedule** — integer math, bigger outputs.
3. **Tax slab calculator** (India slabs, since the hackathon is local-friendly).
4. **Descriptive statistics / outlier detection** over a dataset (median, IQR) — "sensitive data" story.
5. **Credit risk score** — weighted rules; good for dispute demo ("provider inflated score").
6. **Tiny ML inference** — logistic regression or a 2-layer MLP with fixed-point weights baked into WASM. *"Prove the model ran"* is a great pitch line.
7. (Stretch) **Merkle proof / data-integrity check** of a CSV.

---

## 10. Adversarial testing scenarios

Run each from `/admin` (toggle → create request → watch) and from `backend/tests/test_adversarial.py` against devnet.

| # | Scenario | Chaos flag | Detection point | Expected outcome |
|---|---|---|---|---|
| 1 | **Malicious provider** returns tampered output (e.g., `net_cents += 100000`) | `PROVIDER_TAMPER_OUTPUT` | Verifiers' `output_hash` ≠ receipt | mismatch attestations ≥ quorum → dispute → `Rejected`, provider slashed |
| 2 | **Swapped program**: provider runs a different WASM | `PROVIDER_SWAP_PROGRAM` | Provider's own hash check should abort; if bypassed, verifiers mismatch | same as 1 |
| 3 | **Tampered input blob** in storage after request creation (admin edits file) | `STORAGE_TAMPER_INPUT` | Every executor re-hashes input vs chain `input_hash` → abort; UI shows ❌ INPUT TAMPERED | Request `Expired`/re-opened; audit event logged |
| 4 | **Tampered output blob** after receipt | `STORAGE_TAMPER_OUTPUT` | UI/CLI re-hash ≠ chain `output_hash` | Red banner; chain record unaffected (tamper-evident) |
| 5 | **Forged receipt signature** (provider signs with wrong key) | `PROVIDER_BAD_SIG` | On-chain Ed25519 introspection fails | tx rejected; event in logs |
| 6 | **Lazy verifier** copies provider's hash without executing | `VERIFIER_LAZY` | Required `fuel_used`/`trace_root` won't match when provider is honest-but-randomised? → instead: run scenario 1 with lazy verifier; lazy one attests "match" while honest ones mismatch | Lazy verifier is outvoted; its disagreement is recorded on-chain (reputation hit) |
| 7 | **Replay**: resubmit an old receipt to a new request | — | Receipt message includes `request_pda`; signature invalid for new PDA | rejected |
| 8 | **Frivolous dispute** against an honest result | user action | Verifier quorum agrees with provider | challenger stake slashed to provider |
| 9 | **Invalid zk proof** (stretch) | `ZK_CORRUPT_PROOF` | Groth16 verify fails on-chain | tx rejected |

Each scenario should produce an **explorer link** to the rejecting/slashing transaction — judges love clicking those.

---

## 11. Free tools, APIs, models & integrations

### Blockchain
| Tool | Use | Free? |
|---|---|---|
| **Solana devnet** + `solana airdrop` / https://faucet.solana.com | Test SOL | Yes (rate-limited) |
| **Helius** (https://helius.dev) | Faster RPC than public devnet, **webhooks** for program events, enhanced tx parsing | Free tier |
| **QuickNode / Alchemy** Solana | Backup RPC | Free tier |
| **Solana Explorer** (`?cluster=devnet`), **Solscan**, **SolanaFM** | Link every tx | Yes |
| **Anchor** + `anchorpy` + `@coral-xyz/anchor` | Program + clients | OSS |
| **Solana Playground** (https://beta.solpg.io) | Browser IDE (Remix-equivalent) — build/deploy to devnet without a local toolchain; good fallback on Windows | Yes |
| **solana-test-validator** | Local chain for tests | OSS |
| **Phantom / Solflare / Backpack** | Wallets with devnet mode | Yes |
| **Ed25519 native program** | On-chain signature verification | Built-in |
| **sp1-solana** (Succinct) / **RISC Zero** + `risc0-solana` verifier | zk proof verification on Solana (stretch) | OSS; local proving is free (slow) |

### Compute / proofs
| Tool | Use |
|---|---|
| **wasmtime** (+ `wasmtime-py`) | Deterministic metered WASM execution |
| **Binaryen `wasm-opt`** | Shrink WASM |
| **AssemblyScript** | Compile rule sets in the browser (stretch) |
| **SP1** (`cargo prove`) / **RISC Zero** (`cargo risczero`) | zkVM proofs of Rust programs; prove on a laptop (minutes), verify on-chain |

### Storage & integrity
| Tool | Use | Free? |
|---|---|---|
| **Supabase Storage** | Primary blob store | 1 GB free |
| **Pinata** / **Lighthouse.storage** / **Storacha (web3.storage)** | IPFS pinning for decentralised artifact availability (store CID in DB + hash on chain) | Free tiers |
| **Irys devnet** (Arweave-style permanent storage, devnet is free) | Alternative permanent artifact store | Free on devnet |

### Backend / infra
| Tool | Use | Free? |
|---|---|---|
| **Render** (web service) | FastAPI + workers | Free (sleeps after 15 min idle) |
| **cron-job.org** / **UptimeRobot** | Ping `/health` every 10 min to keep Render awake during judging | Free |
| **Supabase Realtime** | Live UI updates | Included |
| **Sentry** | Error tracking FE+BE | Free tier |
| **GitHub Actions** | CI: `anchor test`, `pytest`, `next build` | Free for public repos |

### AI (optional, for the "explain this dispute" feature)
| Provider | Notes |
|---|---|
| **Groq** (Llama 3.x / other OSS models) | Very fast, generous free tier, OpenAI-compatible API |
| **Google Gemini API** | Free tier (Gemini Flash) |
| **OpenRouter** | Several `:free` models behind one API |
| **Claude API** | Best quality explanations if you have credits; use `claude-haiku-5-5` for cheap/fast |
| **Ollama** (local) | Fully offline if you prefer |

Keep AI strictly cosmetic (explanations, summaries). **Never** put an LLM in the verification path — that's the opposite of the pitch.

### Frontend
shadcn/ui · Tailwind · lucide icons · Recharts · `@rjsf/core` (JSON-Schema forms) · `qrcode.react` · `@solana/wallet-adapter-*` · Vercel Analytics (free).

### Standout integrations (cheap to add, high judge impact)
1. **"Verify in my browser"** (zero trust in backend) — biggest differentiator.
2. **Evidence bundle download + offline CLI verifier** — "auditor" story.
3. **Hash-chained audit log anchored on-chain** — tamper-evidence for the off-chain DB too.
4. **Provider reputation from on-chain stats** — economic security story.
5. **IPFS CIDs** next to every artifact — decentralised availability story.
6. **One zk-verified rule set** — "proof without re-execution" headline, even if only one template supports it.
7. **Helius webhook → Supabase Realtime** — the timeline animates live during the demo.

---

## 12. Repo layout

```
verity/
├── programs/verity_core/           # Anchor workspace
│   ├── Anchor.toml  Cargo.toml
│   ├── programs/verity_core/src/{lib.rs,state.rs,errors.rs,events.rs,instructions/*.rs}
│   ├── tests/verity_core.ts
│   └── target/idl/verity_core.json  (commit this; copy to frontend & backend)
├── rulesets/                       # WASM rule sets (Rust crates) + built .wasm + schemas
│   ├── template/  payroll/  loan/  tax/  stats/  risk/  ml/
│   └── build_all.sh
├── backend/                        # FastAPI
│   ├── app/{main.py,auth.py,config.py,routes/*.py,engine/runner.py,chain/{client.py,indexer.py,signer.py},workers/{provider.py,verifier.py,finalizer.py},db.py,audit.py,chaos.py,ai.py}
│   ├── verity_client/              # anchorpy-generated
│   ├── tests/test_adversarial.py
│   ├── requirements.txt  render.yaml  Dockerfile(optional)
├── frontend/                       # Next.js
│   ├── src/app/...  src/components  src/lib/{supabase.ts,solana.ts,verify.ts,hash.ts}  src/idl/
│   └── vercel.json (optional)
├── scripts/
│   ├── deploy_program.py           # direct deploy via solders (see §15)
│   ├── deploy_program.sh           # cargo build-sbf + solana program deploy
│   ├── seed_rulesets.py            # uploads prebuilt WASM + schemas
│   └── verity_cli.py               # offline verifier
├── supabase/migrations/0001_init.sql
└── README.md  Implementation_plan.md  .env.example
```

---

## 13. 30-hour schedule & team split

Assumes 3–4 people. Tracks run in parallel; sync points marked ⏱.

| Hours | Chain (A) | Backend (B) | Frontend (C) | Rule sets / DevOps (D) |
|---|---|---|---|---|
| 0–1 | Agree on ABI, account model, receipt bytes, status enum (this doc). Create repo, `.env.example`. ⏱ |
| 1–4 | Anchor skeleton: Config, Provider, Request, `initialize`, `register/stake`, `create_request`, `claim` | FastAPI skeleton, Supabase JWT auth, SIWS wallet link, Storage upload, canonical JSON + hashing, `/requests/prepare` | Next.js + Tailwind + shadcn, Supabase Google login, wallet adapter, layout, `/rulesets`, `/requests/new` (form from JSON schema) | Supabase project + migration + RLS + buckets; Rust WASM template + payroll ruleset; build pipeline; install Solana toolchain in WSL; get 10 SOL devnet |
| 4–8 | `submit_receipt` with Ed25519 introspection, `attest`, `finalize`, `expire`, events | wasmtime runner, receipt signer, Provider worker, Verifier workers (3 keypairs), anchorpy client-gen | `/requests/[pda]` page: stepper, artifacts + integrity badges, attestation table, explorer links; Supabase Realtime | 3 more rule sets (loan, tax, risk); `verity_cli.py`; GitHub Actions |
| 8 ⏱ | **Deploy program to devnet. Freeze IDL v1.** Everyone integrates against it. |
| 8–12 | `open_dispute`, `resolve_dispute`, slashing, `anchor_audit_root`; Anchor tests 1–6 | Indexer (events → DB → audit_log hash chain), finalizer bot, chaos flags | "Verify in my browser" (WASM in browser + Web Crypto), dispute panel, `/verify/[pda]` public page | Deploy backend to Render + keep-alive; frontend to Vercel; env wiring |
| 12 ⏱ | **First end-to-end happy path on deployed URLs.** |
| 12–16 | Redeploy program if fixes needed (upgradeable); gas/size tuning; docs for §15 | Adversarial pytest suite against devnet; AI explainer; evidence zip | `/admin` chaos panel, `/activity`, `/providers` leaderboard, landing with live stats | IPFS pinning (Pinata); ML inference rule set; Helius webhook |
| 16–20 | (Stretch) SP1 guest for payroll, local proof, `sp1-solana` verify program | Hardening: retries, idempotency, rate limits, error surfaces | Polish: empty states, loading, toasts, mobile; QR codes | README, architecture diagram, demo data seeding |
| 20–24 | Buffer / bug bash across all tracks. Run the full adversarial demo 3× on deployed URLs. |
| 24–27 | Pitch deck (8 slides), 3-minute demo video recording (backup if live demo fails), judge Q&A prep |
| 27–30 | Sleep in shifts / final polish / submission form |

**Cut order if behind:** zk (first to cut) → IPFS → AI explainer → bisection trace → leaderboard. **Never cut:** happy path, browser verification, scenario 1 (tampered output → slash), timeline with explorer links.

---

## 14. Deployment guide

### 14.1 Supabase (free tier)
1. Create project → **Authentication → Providers → Google** (needs OAuth client from Google Cloud Console; add `https://<project>.supabase.co/auth/v1/callback` as redirect URI). Add `http://localhost:3000` and your Vercel URL to **Redirect URLs**.
2. Run `supabase/migrations/0001_init.sql` in the SQL editor. Create buckets `programs`, `inputs`, `outputs`.
3. Copy `SUPABASE_URL`, `SUPABASE_ANON_KEY` (frontend), `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_JWT_SECRET` (backend only).
4. Free tier pauses after 7 days of inactivity — open the dashboard the day before judging.

### 14.2 Backend on Render (free tier)
`backend/render.yaml`:
```yaml
services:
  - type: web
    name: verity-api
    runtime: python
    plan: free
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1
    healthCheckPath: /health
    envVars:
      - key: SOLANA_RPC_URL
        value: https://api.devnet.solana.com   # or Helius devnet URL
      - key: PROGRAM_ID
        sync: false
      - key: PROVIDER_KEYPAIR_JSON     # base64 of the 64-byte secret key array
        sync: false
      - key: VERIFIER_KEYPAIRS_JSON    # JSON array of 3 keypairs
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: SUPABASE_JWT_SECRET
        sync: false
      - key: ADMIN_EMAILS
        value: support@arhamfintech.ai
      - key: FRONTEND_ORIGIN
        sync: false
```
Notes: free instance = 512 MB RAM, 0.1 CPU, sleeps after 15 min idle (cold start ~30–60 s). Run workers as **in-process APScheduler jobs** (Render free doesn't offer background workers). Keep awake with cron-job.org hitting `/health` every 10 min. No Docker-in-Docker — that's why the sandbox is wasmtime in-process, not containers. `wasmtime` wheels install fine on Render's Python runtime.

### 14.3 Frontend on Vercel (free tier)
- Import repo, set **Root Directory** = `frontend`. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` (Render URL), `NEXT_PUBLIC_SOLANA_RPC`, `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_CLUSTER=devnet`.
- Add the Vercel domain to Supabase Auth redirect URLs and to backend CORS.
- `next.config.ts`: `webpack: (c) => { c.experiments = { ...c.experiments, asyncWebAssembly: true }; return c; }` only if you import `.wasm` statically; fetching at runtime (as in §8.3) needs nothing.

### 14.4 Solana program on devnet
See §15. After deploy: put `PROGRAM_ID` in Anchor.toml, `declare_id!`, backend env, frontend env, and commit the IDL. Run `initialize` once (script), `register_provider` + `stake` for the provider keypair, fund verifier keypairs with ~0.5 SOL each for tx fees.

### 14.5 Windows note
The Solana/Agave toolchain (`cargo build-sbf`, `solana-test-validator`) is **WSL2-first**. Install Ubuntu via `wsl --install`, then do all Rust/Anchor/Solana work inside WSL. The Next.js/FastAPI parts run fine natively on Windows. Alternative: Solana Playground in the browser.

---

## 15. Deploying Solana programs directly

### 15.1 Mental model vs Ethereum

| Ethereum | Solana |
|---|---|
| `solc` → bytecode + ABI | `cargo build-sbf` → `program.so` (BPF/SBF ELF) + Anchor IDL (optional) |
| Hardhat / Remix | Anchor CLI / Solana Playground |
| `web3.py`: send a tx whose `data` = bytecode → contract address returned | Upload `.so` into a **buffer account** in ~1 KB chunks (many txs), then one **Deploy** tx creates the **program account** (address = a keypair you generate up front) + **ProgramData** PDA |
| Contract is immutable unless proxy | Programs deployed with the **BPF Loader Upgradeable** are upgradeable by the *upgrade authority* (you); you can later `set-upgrade-authority --final` to freeze |

So the "web3.py to Sepolia, no Hardhat" equivalent on Solana has **three levels**. Pick the one you need.

### 15.2 Level 1 — Build + deploy with only the Solana CLI (no Anchor, no Playground) — *recommended*

The Solana CLI **is** the direct deployer; there is no IDE in the loop. Inside WSL:

```bash
# 1. Install Rust + Agave (Solana) CLI
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version

# 2. Keys + cluster
solana-keygen new -o ~/.config/solana/deployer.json      # upgrade authority / payer
solana config set --url https://api.devnet.solana.com --keypair ~/.config/solana/deployer.json
solana airdrop 5 && solana airdrop 5                        # repeat / use faucet.solana.com
solana balance

# 3. Generate the PROGRAM ID up front (like knowing your contract address before deploy)
solana-keygen new -o target/deploy/verity_core-keypair.json
solana address -k target/deploy/verity_core-keypair.json    # paste into declare_id!("...")

# 4. Build the .so  (works for Anchor crates and native solana-program crates alike)
cd programs/verity_core
cargo build-sbf                                             # → target/deploy/verity_core.so

# 5. Deploy (creates buffer, writes chunks, deploys — all in one command)
solana program deploy target/deploy/verity_core.so \
  --program-id target/deploy/verity_core-keypair.json \
  --upgrade-authority ~/.config/solana/deployer.json \
  --max-len 400000                                          # leave headroom for upgrades

# 6. Verify + later upgrades (same command re-deploys in place)
solana program show <PROGRAM_ID>
solana program deploy target/deploy/verity_core.so --program-id <PROGRAM_ID>
```

If a deploy is interrupted, recover the buffer rent: `solana program show --buffers` → `solana program close --buffers`.

**Anchor's `anchor deploy` is literally a wrapper around step 5.** You can use Anchor purely as a Rust framework (for the macros + IDL) and still deploy with the CLI. To export the IDL without `anchor build`: `anchor idl build` (or just run `anchor build` once locally; it does the same `cargo build-sbf`).

### 15.3 Level 2 — Programmatic deploy from Python (true web3.py-style, no CLI at deploy time)

This is what `solana program deploy` does under the hood, written with `solders` + `solana-py`. Useful for CI or if you insist on a script. It talks to the **BPF Loader Upgradeable** program `BPFLoaderUpgradeab1e11111111111111111111111`.

Instruction layout (bincode, little-endian): `InitializeBuffer=0`, `Write=1 {offset:u32, bytes:Vec<u8>}`, `DeployWithMaxDataLen=2 {max_data_len:u64}`, `Upgrade=3`, `SetAuthority=4`, `Close=5`.
Account sizes: buffer = `37 + len`, program = `36`, programdata = `45 + max_data_len`.

```python
# scripts/deploy_program.py   (pip install solana solders)
import json, sys, struct, time
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.system_program import create_account, CreateAccountParams
from solders.transaction import Transaction
from solders.message import Message
from solders.sysvar import RENT, CLOCK
from solana.rpc.api import Client

LOADER = Pubkey.from_string("BPFLoaderUpgradeab1e11111111111111111111111")
SYSTEM = Pubkey.from_string("11111111111111111111111111111111")
RPC = "https://api.devnet.solana.com"
CHUNK = 900  # bytes per Write tx (tx limit is 1232 bytes total)

def load_kp(path):  # solana-keygen JSON array format
    return Keypair.from_bytes(bytes(json.load(open(path))))

def send(client, ixs, signers, payer):
    bh = client.get_latest_blockhash().value.blockhash
    tx = Transaction([payer, *[s for s in signers if s != payer]], Message.new_with_blockhash(ixs, payer.pubkey(), bh), bh)
    sig = client.send_transaction(tx).value
    client.confirm_transaction(sig, commitment="confirmed")
    return sig

def main(so_path, payer_path, program_kp_path, max_len=None):
    client = Client(RPC)
    payer = load_kp(payer_path)                 # also upgrade authority
    program_kp = load_kp(program_kp_path)       # program id keypair
    buffer_kp = Keypair()
    data = open(so_path, "rb").read()
    max_len = max_len or len(data) * 2

    buffer_len = 37 + len(data)
    program_len = 36
    programdata_len = 45 + max_len
    programdata, _ = Pubkey.find_program_address([bytes(program_kp.pubkey())], LOADER)

    # 1) create buffer + InitializeBuffer
    rent_buf = client.get_minimum_balance_for_rent_exemption(buffer_len).value
    ix_create = create_account(CreateAccountParams(from_pubkey=payer.pubkey(), to_pubkey=buffer_kp.pubkey(),
                    lamports=rent_buf, space=buffer_len, owner=LOADER))
    ix_init = Instruction(LOADER, struct.pack("<I", 0),
                [AccountMeta(buffer_kp.pubkey(), False, True), AccountMeta(payer.pubkey(), False, False)])
    send(client, [ix_create, ix_init], [payer, buffer_kp], payer)

    # 2) Write chunks
    for off in range(0, len(data), CHUNK):
        chunk = data[off:off+CHUNK]
        ix = Instruction(LOADER, struct.pack("<II", 1, off) + struct.pack("<Q", len(chunk)) + chunk,
                [AccountMeta(buffer_kp.pubkey(), False, True), AccountMeta(payer.pubkey(), True, False)])
        send(client, [ix], [payer], payer)
        print(f"wrote {off+len(chunk)}/{len(data)}")

    # 3) create program account + DeployWithMaxDataLen
    rent_prog = client.get_minimum_balance_for_rent_exemption(program_len).value
    ix_create_prog = create_account(CreateAccountParams(from_pubkey=payer.pubkey(), to_pubkey=program_kp.pubkey(),
                    lamports=rent_prog, space=program_len, owner=LOADER))
    ix_deploy = Instruction(LOADER, struct.pack("<IQ", 2, max_len), [
        AccountMeta(payer.pubkey(), True, True),            # payer
        AccountMeta(programdata, False, True),              # programdata PDA
        AccountMeta(program_kp.pubkey(), False, True),      # program
        AccountMeta(buffer_kp.pubkey(), False, True),       # buffer
        AccountMeta(RENT, False, False),
        AccountMeta(CLOCK, False, False),
        AccountMeta(SYSTEM, False, False),
        AccountMeta(payer.pubkey(), True, False),           # upgrade authority
    ])
    sig = send(client, [ix_create_prog, ix_deploy], [payer, program_kp], payer)
    print("DEPLOYED", program_kp.pubkey(), "tx", sig)

if __name__ == "__main__":
    main(*sys.argv[1:])
# python scripts/deploy_program.py target/deploy/verity_core.so ~/.config/solana/deployer.json target/deploy/verity_core-keypair.json
```

Upgrades later = same steps 1–2 into a fresh buffer, then `Upgrade (3)` with accounts `[programdata(w), program(w), buffer(w), spill/payer(w), rent, clock, authority(signer)]`. Sequential writes are slow (~300–800 txs for a 300 KB program); the CLI parallelises them, so for speed use Level 1 and keep Level 2 for the "we understand the loader" talking point. Equivalent in TypeScript: `@solana/web3.js` v1 has `BpfLoaderUpgradeable` helpers in community packages (`@solana-developers/helpers` has `deployProgram`-style utilities) and the `solana-program/loader-v3` client in the new `@solana/kit` ecosystem.

### 15.4 Level 3 — Zero local toolchain: Solana Playground
https://beta.solpg.io — paste the Anchor crate, click Build, connect Playground wallet (auto-airdrops devnet SOL), click Deploy. Exports IDL + program ID. This is the Remix equivalent and is the fallback if WSL setup eats time.

### 15.5 Calling the deployed program from FastAPI (web3.py-style, no Anchor CLI)
```bash
pip install anchorpy
anchorpy client-gen programs/verity_core/target/idl/verity_core.json backend/verity_client
```
```python
from verity_client.instructions import create_request, attest
from verity_client.accounts import Request
ix = attest({"output_hash": oh, "trace_root": tr, "fuel_used": fuel},
            {"verifier": verifier.pubkey(), "request": request_pda, "receipt": receipt_pda, "attestation": att_pda, "system_program": SYSTEM})
send(client, [ix], [verifier], verifier)
req = Request.fetch(client, request_pda)   # typed account read
```
Frontend equivalent: `@coral-xyz/anchor` `Program` with the same IDL (§8.4).

---

## 16. Demo script & judging pitch

**3-minute live demo (rehearse it):**
1. (0:00) Landing → "Organisations outsource computation; nobody can prove it was done right. Verity makes the computation itself verifiable." Show live stats.
2. (0:20) Login with Google, connect Phantom. Pick **Payroll** rule set; fill form; show canonical JSON + hash; sign `create_request` → explorer link appears.
3. (0:50) Timeline animates: Claimed → Receipt (show signature + hashes) → 3 attestations land → Verified, bounty paid. Click a tx on Solana Explorer.
4. (1:20) Click **"Verify in my browser"** → same WASM runs locally → ✅ "Your hash matches the chain. You never trusted our server."
5. (1:40) Open `/admin`, flip **Malicious Provider**. Create a **Credit Risk** request. Receipt arrives with inflated score; verifiers disagree; dispute auto-opens; `resolve_dispute` slashes the provider (show the slashing tx + provider reputation drop). AI explainer summarises what went wrong.
6. (2:30) Flip **Tamper Output Blob** → red "TAMPERED" badge; chain record unchanged. Download evidence bundle; run `verity_cli.py verify <pda>` in a terminal → PASS/FAIL.
7. (2:50) (If built) "And for this rule set we go further: a zk proof verified on-chain — no re-execution needed." Close on the architecture slide.

**Pitch slides (8):** Problem → Insight (commit/receipt/re-execute/dispute) → Architecture → Live demo → Adversarial results table (9 scenarios, all detected) → Why Solana (cheap txs make per-attestation on-chain records practical; Ed25519 native; PDAs) → Roadmap (zk for all rule sets, TEE providers, mainnet staking) → Team.

---

## 17. Risks & fallbacks

| Risk | Mitigation |
|---|---|
| Solana toolchain install on Windows burns hours | WSL2 from minute 0; Solana Playground fallback; one teammate owns it |
| Devnet airdrop rate limits | Collect 10+ SOL early across faucet.solana.com + CLI; share one deployer wallet |
| Ed25519 introspection bugs | Ship `submit_receipt` *without* on-chain sig check first (backend verifies), add introspection at hour 8–12 |
| Non-determinism between wasmtime and browser | No imports, no floats in JSON, canonical JSON, integer math; test every rule set in both at build time (`rulesets/build_all.sh` runs both) |
| Render cold starts during demo | cron-job.org keep-alive + open the API 5 min before presenting |
| Program too large / rent | `lto`, `opt-level="z"`, `--max-len` just above size; devnet SOL is free anyway |
| Supabase Google OAuth misconfig | Set it up in hour 1; also enable email magic link as backup |
| zk proving too slow / toolchain pain | It's a stretch; demo video of the proof if live proving is too slow; never block MVP on it |
| Team blocked on IDL changes | Freeze IDL at hour 8; additive changes only after; keep `idl/` versioned |

---

### Minimal `.env.example`

```
# backend
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=
PROVIDER_KEYPAIR_JSON=
VERIFIER_KEYPAIRS_JSON=
ADMIN_KEYPAIR_JSON=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
FRONTEND_ORIGIN=http://localhost:3000
ADMIN_EMAILS=support@arhamfintech.ai
GROQ_API_KEY=            # optional
PINATA_JWT=              # optional
# frontend
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=
NEXT_PUBLIC_CLUSTER=devnet
```

**Definition of done for the hackathon:** deployed Vercel + Render + devnet program; happy path and scenario 1 work on the deployed URLs; browser verification works; README has the architecture diagram, program ID, and explorer links to one verified and one slashed request.
