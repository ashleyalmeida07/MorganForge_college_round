# Task 02: WASM Rulesets Implementation & Seeding

> **Priority:** P0 (Blocker for Requests & Verification)  
> **Estimated Time:** 1–1.5 hours  
> **Dependencies:** [TASK_1_SUPABASE_DATABASE_SETUP.md](./TASK_1_SUPABASE_DATABASE_SETUP.md)  
> **Target Directory:** `rulesets/`  
> **Target Scripts:** [`backend/scripts/seed_rulesets.py`](file:///d:/Projects/verity/backend/scripts/seed_rulesets.py), [`backend/app/engine/runner.py`](file:///d:/Projects/verity/backend/app/engine/runner.py)

---

## 1. Objective & Architecture

Verity requires deterministic WebAssembly rule sets that run bit-identically in both:
1. The **FastAPI backend** (inside `wasmtime` with fuel metering).
2. The **Requester's browser** (inside browser `WebAssembly.instantiate` via Web Crypto).

To guarantee bit-level determinism across platforms:
* **No WASI imports, no system calls, no clocks, no randomness.**
* **No floating point arithmetic** where serialization can differ across runtimes — use integer cents, basis points (`bps`), or fixed-point math.
* **Canonical JSON output** — alphabetically sorted dictionary keys, compact spacing (`separators=(",", ":")`), UTF-8 encoded.

---

## 2. Rule Set ABI Contract

Every compiled WASM module must export:
* `memory`: WebAssembly linear memory.
* `alloc(len: usize) -> *mut u8`: Allocates linear buffer of `len` bytes for input JSON.
* `compute(ptr: *const u8, len: usize) -> *const u8`: Reads input canonical JSON from `ptr..ptr+len`, computes output, serializes to canonical JSON, and returns a pointer to a buffer formatted as:
  ```
  [4 bytes: output_len as little-endian u32] || [output_len bytes: canonical JSON bytes]
  ```

---

## 3. Directory Layout to Create

Create the `rulesets/` folder in the repository root:

```
verity/
├── rulesets/
│   ├── Cargo.toml                  # Workspace root
│   ├── payroll/                    # Primary demo rule set
│   │   ├── Cargo.toml
│   │   ├── meta.json               # Schemas & example input
│   │   └── src/
│   │       └── lib.rs
│   └── credit_risk/                # Adversarial demo rule set
│       ├── Cargo.toml
│       ├── meta.json
│       └── src/
│           └── lib.rs
```

### 3.1 `rulesets/Cargo.toml` (Workspace)
```toml
[workspace]
members = [
    "payroll",
    "credit_risk"
]
resolver = "2"
```

---

## 4. Rule Set 1: Payroll (`rulesets/payroll/`)

### `rulesets/payroll/Cargo.toml`
```toml
[package]
name = "payroll"
version = "1.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = { version = "1.0", features = ["alloc"] }
```

### `rulesets/payroll/src/lib.rs`
```rust
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct Input {
    salary_cents: u64,
    tax_bps: u32,
    deductions_cents: u64,
}

#[derive(Serialize)]
struct Output {
    deductions_cents: u64,
    gross_cents: u64,
    net_cents: u64,
    tax_cents: u64,
}

fn compute_rule(input: Input) -> Output {
    let tax_cents = (input.salary_cents as u128 * input.tax_bps as u128 / 10_000) as u64;
    let net_cents = input.salary_cents.saturating_sub(tax_cents).saturating_sub(input.deductions_cents);
    Output {
        deductions_cents: input.deductions_cents,
        gross_cents: input.salary_cents,
        net_cents,
        tax_cents,
    }
}

// Canonical JSON helper: serializes serde structs with alphabetically sorted keys
fn to_canonical_json<T: Serialize>(value: &T) -> Vec<u8> {
    let json_val = serde_json::to_value(value).unwrap();
    let sorted_val = sort_json_value(json_val);
    serde_json::to_vec(&sorted_val).unwrap()
}

fn sort_json_value(val: serde_json::Value) -> serde_json::Value {
    match val {
        serde_json::Value::Object(map) => {
            let mut sorted = BTreeMap::new();
            for (k, v) in map {
                sorted.insert(k, sort_json_value(v));
            }
            serde_json::Value::Object(sorted.into_iter().collect())
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(sort_json_value).collect())
        }
        other => other,
    }
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn compute(ptr: *const u8, len: usize) -> *const u8 {
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    let input: Input = match serde_json::from_slice(slice) {
        Ok(i) => i,
        Err(_) => return std::ptr::null(),
    };

    let result = compute_rule(input);
    let mut out_bytes = to_canonical_json(&result);
    let out_len = out_bytes.len() as u32;

    let mut final_buf = Vec::with_capacity(4 + out_bytes.len());
    final_buf.extend_from_slice(&out_len.to_le_bytes());
    final_buf.append(&mut out_bytes);

    let res_ptr = final_buf.as_ptr();
    std::mem::forget(final_buf);
    res_ptr
}
```

### `rulesets/payroll/meta.json`
```json
{
  "name": "Payroll Net Pay Calculator",
  "description": "Calculates deterministic gross, tax, and net pay from base salary, tax basis points, and deductions.",
  "version": "1.0.0",
  "language": "rust",
  "input_schema": {
    "type": "object",
    "required": ["salary_cents", "tax_bps", "deductions_cents"],
    "properties": {
      "salary_cents": {
        "type": "integer",
        "title": "Gross Salary (cents)",
        "minimum": 0,
        "default": 1000000
      },
      "tax_bps": {
        "type": "integer",
        "title": "Tax Rate (Basis Points, 100 bps = 1%)",
        "minimum": 0,
        "maximum": 10000,
        "default": 2000
      },
      "deductions_cents": {
        "type": "integer",
        "title": "Pre-tax Deductions (cents)",
        "minimum": 0,
        "default": 50000
      }
    }
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "gross_cents": { "type": "integer" },
      "tax_cents": { "type": "integer" },
      "deductions_cents": { "type": "integer" },
      "net_cents": { "type": "integer" }
    }
  },
  "example_input": {
    "salary_cents": 1000000,
    "tax_bps": 2000,
    "deductions_cents": 50000
  }
}
```

---

## 5. Rule Set 2: Credit Risk (`rulesets/credit_risk/`)

Used for the adversarial scenario where a malicious provider inflates an applicant's credit score.

### `rulesets/credit_risk/Cargo.toml`
```toml
[package]
name = "credit_risk"
version = "1.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = { version = "1.0", features = ["alloc"] }
```

### `rulesets/credit_risk/src/lib.rs`
```rust
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct Input {
    annual_income_cents: u64,
    total_debt_cents: u64,
    credit_history_months: u32,
    delinquencies: u32,
}

#[derive(Serialize)]
struct Output {
    base_score: u32,
    dti_penalty: u32,
    delinquency_penalty: u32,
    history_bonus: u32,
    final_score: u32,
    risk_tier: String,
}

fn compute_rule(input: Input) -> Output {
    let mut score: i32 = 650; // starting baseline

    // Debt to income
    let dti_bps = if input.annual_income_cents > 0 {
        ((input.total_debt_cents as u128 * 10_000) / input.annual_income_cents as u128) as u32
    } else {
        10_000
    };

    let dti_penalty = if dti_bps > 5000 {
        100
    } else if dti_bps > 3600 {
        50
    } else {
        0
    };
    score -= dti_penalty as i32;

    let del_penalty = (input.delinquencies * 60).min(200);
    score -= del_penalty as i32;

    let hist_bonus = (input.credit_history_months / 12 * 10).min(100);
    score += hist_bonus as i32;

    let final_score = score.clamp(300, 850) as u32;
    let risk_tier = match final_score {
        740..=850 => "LOW_RISK".to_string(),
        670..=739 => "MEDIUM_RISK".to_string(),
        _ => "HIGH_RISK".to_string(),
    };

    Output {
        base_score: 650,
        dti_penalty,
        delinquency_penalty: del_penalty,
        history_bonus: hist_bonus,
        final_score,
        risk_tier,
    }
}

fn to_canonical_json<T: Serialize>(value: &T) -> Vec<u8> {
    let json_val = serde_json::to_value(value).unwrap();
    let sorted_val = sort_json_value(json_val);
    serde_json::to_vec(&sorted_val).unwrap()
}

fn sort_json_value(val: serde_json::Value) -> serde_json::Value {
    match val {
        serde_json::Value::Object(map) => {
            let mut sorted = BTreeMap::new();
            for (k, v) in map {
                sorted.insert(k, sort_json_value(v));
            }
            serde_json::Value::Object(sorted.into_iter().collect())
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(sort_json_value).collect())
        }
        other => other,
    }
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn compute(ptr: *const u8, len: usize) -> *const u8 {
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    let input: Input = match serde_json::from_slice(slice) {
        Ok(i) => i,
        Err(_) => return std::ptr::null(),
    };

    let result = compute_rule(input);
    let mut out_bytes = to_canonical_json(&result);
    let out_len = out_bytes.len() as u32;

    let mut final_buf = Vec::with_capacity(4 + out_bytes.len());
    final_buf.extend_from_slice(&out_len.to_le_bytes());
    final_buf.append(&mut out_bytes);

    let res_ptr = final_buf.as_ptr();
    std::mem::forget(final_buf);
    res_ptr
}
```

### `rulesets/credit_risk/meta.json`
```json
{
  "name": "Credit Risk Assessment Model",
  "description": "Deterministic credit risk scoring model evaluating Debt-to-Income (DTI), credit history length, and past delinquencies.",
  "version": "1.0.0",
  "language": "rust",
  "input_schema": {
    "type": "object",
    "required": ["annual_income_cents", "total_debt_cents", "credit_history_months", "delinquencies"],
    "properties": {
      "annual_income_cents": {
        "type": "integer",
        "title": "Annual Income (cents)",
        "minimum": 0,
        "default": 8500000
      },
      "total_debt_cents": {
        "type": "integer",
        "title": "Total Outstanding Debt (cents)",
        "minimum": 0,
        "default": 2400000
      },
      "credit_history_months": {
        "type": "integer",
        "title": "Length of Credit History (months)",
        "minimum": 0,
        "default": 48
      },
      "delinquencies": {
        "type": "integer",
        "title": "Number of Past Delinquencies",
        "minimum": 0,
        "default": 0
      }
    }
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "base_score": { "type": "integer" },
      "dti_penalty": { "type": "integer" },
      "delinquency_penalty": { "type": "integer" },
      "history_bonus": { "type": "integer" },
      "final_score": { "type": "integer" },
      "risk_tier": { "type": "string" }
    }
  },
  "example_input": {
    "annual_income_cents": 8500000,
    "total_debt_cents": 2400000,
    "credit_history_months": 48,
    "delinquencies": 0
  }
}
```

---

## 6. Build & Seeding Instructions

### Step 1: Add the WASM Target
```powershell
rustup target add wasm32-unknown-unknown
```

### Step 2: Compile the Rule Sets
From the repository root:
```powershell
cd rulesets
cargo build --release --target wasm32-unknown-unknown
```

This compiles:
* `rulesets/target/wasm32-unknown-unknown/release/payroll.wasm`
* `rulesets/target/wasm32-unknown-unknown/release/credit_risk.wasm`

### Step 3: Run the Seeding Script
```powershell
cd d:\Projects\verity
backend\.venv\Scripts\python backend/scripts/seed_rulesets.py --dir rulesets --no-ipfs
```

*(Note: Add Pinata credentials to `.env` if you wish to pin to IPFS, otherwise `--no-ipfs` bypasses it gracefully).*

### Expected Output:
```
seeding 2 rule sets from rulesets/ ...
[payroll] validating module ... OK
[payroll] testing example_input ... OK (fuel: 14203)
[payroll] uploading wasm to programs/c91a...wasm ... OK
[payroll] upserting programs table ... OK
[credit_risk] validating module ... OK
[credit_risk] testing example_input ... OK (fuel: 16840)
[credit_risk] uploading wasm to programs/7b3e...wasm ... OK
[credit_risk] upserting programs table ... OK
seeded 2 rule sets successfully
```

---

## 7. Verification

Verify that the FastAPI backend recognizes the seeded programs:

```powershell
cd d:\Projects\verity\backend
.\.venv\Scripts\python -c "from app.db import table; print('Seeded programs:', [p['name'] for p in table('programs').select('name').execute().data])"
```

Once this output shows `['Payroll Net Pay Calculator', 'Credit Risk Assessment Model']`, proceed to **Task 03**.
