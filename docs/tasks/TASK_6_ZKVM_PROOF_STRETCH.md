# Task 06: (Stretch) zkVM Execution Proofs (SP1 / RISC Zero)

> **Priority:** P2 (Optional Stretch Goal)  
> **Estimated Time:** 2–3 hours  
> **Dependencies:** [TASK_1_SUPABASE_DATABASE_SETUP.md](./TASK_1_SUPABASE_DATABASE_SETUP.md) through [TASK_5_DEPLOYMENT_AND_INFRASTRUCTURE.md](./TASK_5_DEPLOYMENT_AND_INFRASTRUCTURE.md)  
> **Note:** Only proceed with this task after the core optimistic re-execution and dispute flow (Tasks 1–5) is verified and deployed.

---

## 1. Concept: Proof of Execution Without Re-Execution

In the standard Verity optimistic model:
* Verifiers re-execute the WASM module in `wasmtime` or in the browser.
* If a disagreement occurs, a dispute is resolved via consensus and stake slashing.

In the **zkVM stretch layer**:
* The Provider runs the rule set inside a zero-knowledge Virtual Machine (**SP1** by Succinct or **RISC Zero**).
* The zkVM produces a succinct **Groth16 cryptographic proof** asserting that the execution trace was valid for the given input and output.
* The Solana program verifies the proof on-chain in constant time using the `sp1-solana` verifier program.
* **No independent re-execution is required** — the mathematical proof guarantees correctness.

---

## 2. Architecture & Tooling

```
Rust Rule Set (e.g. Payroll)
          │
          ▼
   SP1 Guest Program
          │
          ▼  cargo prove (offline on laptop)
  Groth16 Proof (SP1 Proof)
          │
          ▼
  Solana Devnet: sp1-solana verifier program
          │
          ▼ CPI
  verity_core: mark Request as Verified
```

---

## 3. Step-by-Step Implementation Outline

### Step 1: Install SP1 Toolchain
```bash
curl -L https://sp1.succinct.xyz | bash
sp1up
cargo prove --version
```

### Step 2: Create the SP1 Guest Program
In a new directory `programs/zk_payroll_guest/`:
```rust
#![no_main]
sp1_zkvm::entrypoint!(main);

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct Input {
    salary_cents: u64,
    tax_bps: u32,
    deductions_cents: u64,
}

#[derive(Serialize)]
struct Output {
    gross_cents: u64,
    tax_cents: u64,
    net_cents: u64,
}

pub fn main() {
    let input: Input = sp1_zkvm::io::read();
    let tax = (input.salary_cents as u128 * input.tax_bps as u128 / 10_000) as u64;
    let net = input.salary_cents.saturating_sub(tax).saturating_sub(input.deductions_cents);
    let output = Output {
        gross_cents: input.salary_cents,
        tax_cents: tax,
        net_cents: net,
    };
    sp1_zkvm::io::commit(&output);
}
```

### Step 3: Generate the Proof Offline
Run the proof generator on your local machine:
```bash
cargo prove build
cargo prove prove --groth16
```
This generates a proof file (`proof.json`) and public values.

### Step 4: Verification on Solana
Integrate with the `sp1-solana` verifier contract on devnet:
* Provide the Groth16 verification key and proof bytes.
* Call the verification instruction in your transaction.

---

## 4. Judging Pitch Fallback

If proof generation on your laptop takes too long (e.g. > 5 minutes):
* Do **not** block the live presentation.
* Run a pre-generated proof offline ahead of time.
* Present the architecture slide showing how zkVM complements the optimistic model:
  > *"For lightweight computations, Verity uses instant optimistic verification with browser re-execution. For high-value enterprise computations, Verity supports zkVM proofs via SP1 on Solana, allowing verification without any re-execution."*
