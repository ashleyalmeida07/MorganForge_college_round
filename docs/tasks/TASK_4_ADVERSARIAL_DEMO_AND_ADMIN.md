# Task 04: Adversarial Demo & Admin Panel Integration

> **Priority:** P1 (High Impact for Judges & Demo)  
> **Estimated Time:** 1–1.5 hours  
> **Dependencies:** [TASK_1_SUPABASE_DATABASE_SETUP.md](./TASK_1_SUPABASE_DATABASE_SETUP.md), [TASK_2_WASM_RULESETS.md](./TASK_2_WASM_RULESETS.md), [TASK_3_FRONTEND_IMPLEMENTATION.md](./TASK_3_FRONTEND_IMPLEMENTATION.md)  
> **Target Files:**  
> - [`frontend/src/app/admin/page.tsx`](file:///d:/Projects/verity/frontend/src/app/admin)  
> - [`backend/tests/test_adversarial.py`](file:///d:/Projects/verity/backend/tests/test_adversarial.py)  
> - [`backend/scripts/verity_cli.py`](file:///d:/Projects/verity/backend/scripts/verity_cli.py)

---

## 1. Objective

Judges look for proof that Verity can withstand Byzantine and adversarial conditions. The platform must actively detect and penalize cheating providers, corrupted storage, forged signatures, and lazy verifiers.

This task integrates:
1. An interactive **Admin Chaos Control Panel** at `/admin`.
2. A step-by-step **3-minute live pitch demonstration script**.
3. Automated verification using `test_adversarial.py` and `verity_cli.py`.

---

## 2. The 6 Chaos Flags & Expected Outcomes

| # | Chaos Flag | Action Triggered | Detection Mechanism | On-Chain Result |
|---|---|---|---|---|
| **1** | `PROVIDER_TAMPER_OUTPUT` | Provider inflates net pay or credit score | Verifiers re-execute wasmtime; compute hash mismatch | Mismatch quorum (≥2) → Dispute opened → Provider slashed 0.1 SOL |
| **2** | `PROVIDER_SWAP_PROGRAM` | Provider executes different WASM code | Hash of downloaded WASM ≠ on-chain `program_hash` | Aborts execution; request times out & refunds bounty |
| **3** | `STORAGE_TAMPER_INPUT` | Admin alters JSON input blob in Supabase bucket | Hash of input ≠ on-chain `input_hash` | Provider/Verifiers abort; UI shows `INPUT TAMPERED ❌` |
| **4** | `STORAGE_TAMPER_OUTPUT` | Admin alters output blob after receipt posted | Hash of output blob ≠ on-chain `output_hash` | UI shows `OUTPUT TAMPERED ❌`; on-chain record unaffected |
| **5** | `PROVIDER_BAD_SIG` | Provider signs receipt with unauthorized keypair | Ed25519 precompile instruction introspection fails | Solana transaction rejected on-chain; receipt never stored |
| **6** | `VERIFIER_LAZY` | One verifier blindly copies provider's output hash | Lazy verifier outvoted by 2 honest verifiers | Lazy vote recorded on-chain; honest consensus slashes provider |

---

## 3. Implement `/admin` Chaos Dashboard (`frontend/src/app/admin/page.tsx`)

Create [`frontend/src/app/admin/page.tsx`](file:///d:/Projects/verity/frontend/src/app/admin/page.tsx):

```tsx
"use client";

import React, { useEffect, useState } from "react";
import { ShieldAlert, AlertTriangle, Play, RefreshCw, CheckCircle, Database } from "lucide-react";

interface ChaosFlag {
  name: string;
  enabled: boolean;
  updated_at?: string;
}

const CHAOS_DESCRIPTIONS: Record<string, { label: string; desc: string }> = {
  PROVIDER_TAMPER_OUTPUT: {
    label: "Malicious Provider (Tamper Output)",
    desc: "Provider mutates the computed result (e.g. net_cents += 100000) before signing the receipt.",
  },
  PROVIDER_SWAP_PROGRAM: {
    label: "Swapped Rule Set / Program",
    desc: "Provider executes an unauthorized WASM binary instead of the agreed program hash.",
  },
  STORAGE_TAMPER_INPUT: {
    label: "Tamper Input Storage Blob",
    desc: "Simulates an off-chain database attacker modifying the input JSON in Supabase Storage.",
  },
  STORAGE_TAMPER_OUTPUT: {
    label: "Tamper Output Storage Blob",
    desc: "Simulates an attacker tampering with the output JSON after receipt submission.",
  },
  PROVIDER_BAD_SIG: {
    label: "Forged Receipt Signature",
    desc: "Provider signs the execution receipt with an unauthorized private key.",
  },
  VERIFIER_LAZY: {
    label: "Lazy Verifier Node",
    desc: "Verifier 1 copies the provider's output without independently executing the WASM module.",
  },
};

export default function AdminChaosPage() {
  const [flags, setFlags] = useState<ChaosFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeJob, setActiveJob] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const fetchFlags = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/chaos`);
      if (res.ok) {
        const data = await res.json();
        setFlags(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlags();
  }, []);

  const toggleFlag = async (name: string, currentVal: boolean) => {
    try {
      const res = await fetch(`${API_URL}/admin/chaos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag: name, enabled: !currentVal }),
      });
      if (res.ok) {
        setFlags((prev) =>
          prev.map((f) => (f.name === name ? { ...f, enabled: !currentVal } : f))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerWorker = async (job: string) => {
    setActiveJob(job);
    try {
      await fetch(`${API_URL}/admin/run/${job}`, { method: "POST" });
    } finally {
      setTimeout(() => setActiveJob(null), 1000);
    }
  };

  return (
    <div className="container mx-auto py-10 px-4 max-w-5xl">
      <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-red-500">
            <ShieldAlert className="h-8 w-8" />
            Adversarial Testing & Chaos Panel
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Toggle Byzantine failure modes to demonstrate real-time fraud detection, consensus quorum rejection, and stake slashing on Solana devnet.
          </p>
        </div>
        <button
          onClick={fetchFlags}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-medium text-slate-200 transition"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        {flags.map((flag) => {
          const info = CHAOS_DESCRIPTIONS[flag.name] || {
            label: flag.name,
            desc: "Custom test flag",
          };
          return (
            <div
              key={flag.name}
              className={`p-6 rounded-xl border transition-all ${
                flag.enabled
                  ? "bg-red-950/20 border-red-500/50 shadow-lg shadow-red-500/10"
                  : "bg-slate-900/60 border-slate-800"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg text-slate-100 flex items-center gap-2">
                    {flag.enabled && <AlertTriangle className="h-5 w-5 text-red-500" />}
                    {info.label}
                  </h3>
                  <p className="text-sm text-slate-400 mt-2 leading-relaxed">{info.desc}</p>
                </div>
                <button
                  onClick={() => toggleFlag(flag.name, flag.enabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    flag.enabled ? "bg-red-600" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      flag.enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
                <span>Code: <code>{flag.name}</code></span>
                <span className={flag.enabled ? "text-red-400 font-medium" : "text-emerald-500"}>
                  {flag.enabled ? "ACTIVATED (BYZANTINE)" : "INACTIVE (HONEST)"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Manual Worker Controls */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800">
        <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Play className="h-5 w-5 text-blue-400" />
          Immediate Worker Dispatcher
        </h2>
        <div className="flex flex-wrap gap-4">
          {["provider", "verifier", "finalizer", "indexer"].map((worker) => (
            <button
              key={worker}
              onClick={() => triggerWorker(worker)}
              disabled={activeJob === worker}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-sm font-medium text-slate-300 transition"
            >
              {activeJob === worker ? "Running..." : `Trigger ${worker.toUpperCase()}`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

## 4. Rehearsed 3-Minute Live Demo Pitch Script

Use this exact timeline when presenting to judges:

### ⏱️ 0:00 – 0:30: The Hook & Architecture
> *"In outsourced compute, you either blindly trust an off-chain API, or you waste resources re-computing everything on an expensive L1. Verity solves this on Solana: commit → execute → signed receipt → independent re-execution → dispute with slashing."*
* Show the Landing Page live counters.

### ⏱️ 0:30 – 1:15: Happy Path & Zero-Trust Browser Verification
> *"Here is our Payroll computation. We submit the job on Solana Devnet with a 0.01 SOL bounty."*
* Open `/requests/new`, submit with Phantom wallet.
* Navigate to `/requests/[pda]`:
  * Watch timeline update live: `Open` → `Claimed` → `Receipt` → `2 Verifier Attestations` → `Verified`.
  * Click **"Run Local Verification in My Browser"**.
  * Point to the green verification badge: *"Notice: My laptop compiled and ran this exact WASM module in memory and matched the on-chain hash bit-for-bit without querying the backend."*

### ⏱️ 1:15 – 2:15: The Adversarial Moment (Slashing Live on Devnet)
> *"Now let's test what happens when a provider cheats."*
* Switch to `/admin` and flip **`PROVIDER_TAMPER_OUTPUT`** ON.
* Create a **Credit Risk** request.
* Show the provider posting an inflated credit score.
* Point to the Attestation Table:
  * Both verifiers report **Mismatch ❌**.
  * The dispute auto-opens.
  * Show the final status: **`Rejected`**.
  * Click the `resolve_dispute` transaction on Solana Explorer: **Provider's 0.1 SOL stake was slashed and distributed to the challenger and honest verifiers!**

### ⏱️ 2:15 – 2:45: Off-Chain Storage Tamper Evidence
* In `/admin`, flip **`STORAGE_TAMPER_OUTPUT`** ON.
* Return to the request detail page.
* Point to the red **`OUTPUT BLOB TAMPERED ❌`** warning:
  * *"Even if an attacker gains root access to our database or AWS S3 and tampers with the output file, our cryptographic commitments on Solana detect the corruption instantly."*

### ⏱️ 2:45 – 3:00: Offline Auditor Verification
* Switch to a terminal and run:
  ```powershell
  python backend/scripts/verity_cli.py verify <REQUEST_PDA>
  ```
* Show the terminal output printing `INTEGRITY VERIFIED: ALL CHECKS PASS`.
* Conclude: *"Verity turns any computation into an immutable, verifiable proof."*

---

## 5. Automated Devnet Adversarial Suite

Run the full automated test suite to ensure all failure modes pass before the demo:

```powershell
cd d:\Projects\verity\backend
$env:VERITY_E2E="1"
.\.venv\Scripts\pytest -m devnet tests/test_adversarial.py -v -s
```
