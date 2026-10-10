# CONTEXT.md — Verity

> Read this first. It is the single source of truth for what we are building, why, and how.
> If code and this file disagree, fix one of them. Update this file when decisions change.

---

## 1. Event & Problem

- **Event:** GDG On Campus, Fr. CRCE — *Bit N Build: Around the World*, **College Round**
- **Track:** Blockchain
- **Problem Statement 3:** **Verity: Prove the Computation, Not Just the Result**

**Official problem statement (condensed):**
Build a blockchain-based verifiable computation platform where one party requests a computation from another and can independently verify the returned result follows the agreed rules, without blindly trusting the provider or repeating the expensive computation.

**Required features (judging checklist):**

| # | Feature | Our answer |
|---|---------|-----------|
| 1 | Verifiable Computation | Optimistic execution with a Merkle-committed step trace + on-chain single-step verification |
| 2 | Independent Verification | Anyone can replay locally and challenge on-chain; verifier CLI + UI button |
| 3 | Tamper-Evident Records | On-chain commitments + event log; trace root anchored on-chain |
| 4 | Input and Output Integrity | Input dataset Merkle root + program hash + result hash committed at job creation/submission |
| 5 | Dispute Resolution | Interactive bisection game narrowing to one disputed step, resolved on-chain |
| 6 | Adversarial Testing | "Malicious provider" mode: tampered output, forged trace, wrong program, bad input |
| 7 | Execution Traceability | Timeline of request → execution → submission → challenge → verdict from chain events |

---

## 2. Core Idea (one paragraph)

The provider runs a deterministic computation off-chain and publishes a **Merkle root over every intermediate state** (the execution trace) plus the final result. The chain does not re-run the whole job. If a challenger disagrees, both sides run a **bisection game** to find the first step where they disagree, and the contract re-executes **only that single step** on-chain. The cheater loses their bond. Honest results finalize after a challenge window with no on-chain compute.

Trust model: **1 honest verifier is enough** (optimistic / Truebit- and Arbitrum-style).

---

## 3. Scope

### In scope (MVP — must work in the demo)
- Smart contract: job lifecycle, bonds, trace commitment, bisection dispute, single-step verification, slashing, finalization.
- Off-chain **Provider** service (honest and malicious modes).
- Off-chain **Verifier/Challenger** service (watches chain, replays, auto-challenges).
- **Requester/Dashboard** web app: create job, view status, timeline, disputes, verdicts.
- Deterministic reference computation (see §4).
- Adversarial test suite + live "tamper" demo toggle.

### Stretch (only after MVP is solid)
- zk-SNARK (Circom + snarkjs, Groth16) for a small instance of the same computation, verified by a Solidity verifier. Shown as the "fast path" alongside optimistic mode.
- Provider reputation score.
- IPFS for large datasets (hash pinned on-chain).

### Out of scope
- General-purpose zkVM / full EVM-in-EVM.
- Privacy of inputs (we prove correctness, not confidentiality).
- Mainnet deployment, token economics, production key management.

---

## 4. The Reference Computation

Chosen so that (a) it is deterministic, (b) one step is cheap to re-execute in Solidity, (c) the trace is short enough to demo bisection live.

**Job type: statistical aggregate over a dataset** (mean and variance, integer fixed-point).

- **Input:** array of `N` integers (e.g. N = 1024 for demo). Committed as a Merkle root `inputRoot`.
- **State at step i:** `(i, sum_i, sumSq_i)`
- **Step function `f`:** consume `data[i]` (supplied with a Merkle proof against `inputRoot`) →
  `sum_{i+1} = sum_i + data[i]`, `sumSq_{i+1} = sumSq_i + data[i]^2`, `i+1`
- **Final result:** `(sum_N, sumSq_N)` → mean/variance derived off-chain/UI from these.
- **State hash:** `keccak256(abi.encode(i, sum, sumSq))`
- **Trace root:** Merkle root over `[stateHash_0 ... stateHash_N]`.

Rules (must hold everywhere): integer math only, no floats, no randomness, no time dependence, fixed ordering. Solidity (`uint256`, checked math) and provider code (Python/TS BigInt) must produce **identical** state hashes. Cross-language test vectors live in `/test-vectors`.

> If time allows, add a second job type (e.g. small matrix multiply or hash chain) to show the platform is generic. Do not do this before MVP is done.

---

## 5. Protocol

### 5.1 Job lifecycle

```
Requested → Accepted → Submitted → (Challenged → Resolved) → Finalized
                                  ↘ (no challenge in window) ↗
Expired / Cancelled / Slashed are terminal side states
```

1. **createJob** (Requester): `inputRoot`, `programHash`, `N`, `reward`, `challengeWindow`, `deadline`. Escrows reward.
2. **acceptJob** (Provider): posts `providerBond`.
3. **submitResult** (Provider): `traceRoot`, `finalState` (`sum`, `sumSq`), total `steps`. Starts challenge window.
4. **challenge** (anyone): posts `challengerBond`, claims `finalState` is wrong (supplies own claimed state/trace root).
5. **Bisection**: alternate rounds. Each round the provider reveals the state hash at the midpoint of the current disputed range `[lo, hi]`; the challenger says agree/disagree; range halves. Per-move timeout → forfeits.
6. **resolveStep**: when range is a single step `[k, k+1]`, contract takes `state_k`, `data[k]` + Merkle proof, computes `f(state_k)`, compares to disputed `state_{k+1}`. Loser slashed; winner gets their bond + part of the loser's bond.
7. **finalize**: after the window with no challenge (or after resolution), release reward to Provider (or refund Requester if provider slashed).

### 5.2 Security properties we claim (and must demo)
- **Soundness:** an incorrect result is rejected if at least one honest challenger acts within the window.
- **Input integrity:** every consumed data element must verify against `inputRoot`.
- **Program integrity:** `programHash` fixed at job creation; contract only supports registered step functions.
- **Liveness:** timeouts on every party action; no funds locked forever.
- **Tamper evidence:** all commitments and verdicts are emitted as events and are immutable.

### 5.3 Known limitations (document these honestly in the pitch)
- Requires at least one honest, online verifier during the window.
- Challenge window adds latency before finality.
- Only supports registered deterministic step functions, not arbitrary code.
- Does not hide inputs.

---

## 6. Architecture

```
┌────────────┐   createJob / finalize   ┌──────────────────┐   events   ┌─────────────┐
│ Requester  │ ───────────────────────► │ Verity contracts │ ─────────► │  Indexer /  │
│ (Web UI)   │ ◄─────── status ──────── │ (Solidity, EVM)  │            │  Timeline   │
└────────────┘                          └──────────────────┘            └─────────────┘
                                          ▲            ▲
                          accept/submit   │            │  challenge/bisect
                                   ┌──────┴────┐  ┌────┴───────┐
                                   │ Provider  │  │ Verifier / │
                                   │ (honest / │  │ Challenger │
                                   │ malicious)│  │ (watcher)  │
                                   └───────────┘  └────────────┘
```

**Contracts**
- `VerityJobs.sol` — job registry, escrow, bonds, lifecycle, events.
- `DisputeGame.sol` — bisection state machine and timeouts.
- `StepVerifier.sol` — pure `f(state, element) -> state` + Merkle proof verification.
- `MerkleLib.sol` — keccak Merkle build-verify helpers (sorted-pair or index-aware; pick one and keep it consistent with off-chain code).

**Off-chain**
- `provider/` — executes the job, builds the trace + Merkle tree, serves trace data (needed for bisection), submits result. Flag `--malicious=<mode>`.
- `verifier/` — subscribes to `ResultSubmitted`, replays the computation independently, compares roots, auto-challenges and plays the bisection game.
- `shared/` — canonical state encoding, hashing, Merkle tree, test vectors (single implementation imported by provider and verifier).

**Frontend**
- Create job, upload/generate dataset, view provider/verifier status.
- Timeline view (all events per job).
- Dispute view: visual bisection (range narrowing), final disputed step, verdict.
- Demo controls: "Run honest" / "Run malicious: <mode>".

---

## 7. Adversarial Scenarios (the demo and the test suite)

| Mode | Attack | Expected outcome |
|------|--------|------------------|
| `wrong-result` | Submit correct trace but altered final sum | Challenge → bisection ends at last step → provider slashed |
| `forged-trace` | Honest start, corrupt state at step k | Bisection converges on k → slashed |
| `wrong-input` | Compute over a modified dataset | Merkle proof of `data[i]` fails vs `inputRoot` → slashed |
| `wrong-program` | Use a different step function | State transition mismatch at first differing step → slashed |
| `lazy` | Skip computation, submit random root | Slashed at first step |
| `false-challenge` | Challenger disputes an honest result | Challenger slashed, provider rewarded |
| `timeout` | Provider stops responding mid-dispute | Forfeit by timeout |

Each row needs an automated test **and** a one-click demo path.

---

## 8. Tech Stack (proposed, confirm before locking)

- **Contracts:** Solidity ^0.8.x, **Foundry** (fast tests, fuzzing) or Hardhat
- **Chain:** local Anvil/Hardhat node for dev; Sepolia (or similar testnet) for the final demo
- **Provider / Verifier:** Python or TypeScript (pick one for both; use BigInt/ints, never floats)
- **Frontend:** React + Vite/Next.js, ethers.js/viem, a simple timeline + range-visualization component
- **Optional zk:** Circom + snarkjs (Groth16)

---

## 9. Repository Layout

```
verity/
├─ CONTEXT.md
├─ README.md
├─ contracts/
│  ├─ src/ (VerityJobs, DisputeGame, StepVerifier, MerkleLib)
│  ├─ test/
│  └─ script/ (deploy)
├─ offchain/
│  ├─ shared/     # encoding, hashing, merkle, step fn
│  ├─ provider/
│  └─ verifier/
├─ web/
├─ test-vectors/  # cross-language hash/merkle/step vectors (JSON)
└─ docs/          # architecture diagram, threat model, pitch notes
```

---

## 10. Conventions

- **Determinism first.** Any change to encoding/hash/step function must update `test-vectors/` and pass cross-language tests in both Solidity and off-chain code.
- Canonical encoding: `abi.encode` for state hashing everywhere.
- All money amounts in wei, integers only.
- Every contract state change emits an event (the UI timeline is built from events only).
- No hardcoded private keys. `.env` for keys/RPC; `.env.example` committed.
- Small PRs/commits, one feature each; tests with each contract change.
- Gas matters in `resolveStep` only; keep it a single Merkle verify + one step.

---

## 11. Definition of Done (MVP)

- [ ] Honest job runs end-to-end and finalizes with no on-chain recompute.
- [ ] At least 4 attack modes from §7 are caught and slashed, live and in tests.
- [ ] Bisection visualized in UI with the final disputed step shown.
- [ ] Timeline shows full history of a job from events.
- [ ] Cross-language test vectors pass.
- [ ] README with 60-second setup and the demo script.
- [ ] Threat model + limitations page (what we guarantee, what we don't).

---

## 12. Demo Script (target ≈ 3 minutes)

1. **Problem (20s):** "A provider says the answer is X. How do you know without redoing the work?"
2. **Honest run (40s):** create job → provider executes → result submitted → verifier replays, agrees → finalizes → timeline.
3. **Malicious run (90s):** toggle `forged-trace` → provider submits bad result → verifier auto-challenges → UI shows bisection halving the range → single step re-executed on-chain → provider slashed, requester refunded.
4. **Close (30s):** guarantees, honest limitations, stretch (zk path).

---

## 13. Team & Roles

> Fill in. Suggested split:

| Area | Owner |
|------|-------|
| Contracts (jobs, dispute game, step verifier) | _TBD_ |
| Off-chain provider + verifier + shared lib | _TBD_ |
| Frontend + timeline + bisection visual | _TBD_ |
| Tests, attack modes, pitch, docs | _TBD_ |

---

## 14. Open Decisions

- [ ] Foundry vs Hardhat
- [ ] Python vs TypeScript for off-chain
- [ ] Merkle scheme (sorted-pair vs index-aware) — must be fixed before writing test vectors
- [ ] Dataset size N and bisection depth for demo (N = 1024 → ~10 rounds)
- [ ] Testnet for final demo
- [ ] Whether to attempt the zk stretch goal

---

## 15. Glossary

- **Trace:** ordered list of intermediate states of a computation.
- **Trace root:** Merkle root over state hashes of the trace.
- **Bisection:** interactive protocol that halves the disputed step range until one step remains.
- **Bond:** collateral each party stakes; loser is slashed.
- **Challenge window:** period after submission in which anyone may dispute.
