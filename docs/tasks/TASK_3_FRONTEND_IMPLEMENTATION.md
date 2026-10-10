# Task 03: Next.js Frontend Implementation & Integration

> **Priority:** P0 (Core User Experience & Demo Interface)  
> **Estimated Time:** 4–6 hours  
> **Dependencies:** [TASK_1_SUPABASE_DATABASE_SETUP.md](./TASK_1_SUPABASE_DATABASE_SETUP.md), [TASK_2_WASM_RULESETS.md](./TASK_2_WASM_RULESETS.md)  
> **Target Directory:** `frontend/`  
> **Key Files to Create/Update:**  
> - [`frontend/src/idl/verity_core.json`](file:///d:/Projects/verity/frontend/src/idl/verity_core.json)  
> - [`frontend/src/lib/verify.ts`](file:///d:/Projects/verity/frontend/src/lib/verify.ts)  
> - [`frontend/src/lib/solana.ts`](file:///d:/Projects/verity/frontend/src/lib/solana.ts)  
> - [`frontend/src/app/requests/[pda]/page.tsx`](file:///d:/Projects/verity/frontend/src/app/requests)

---

## 1. Objective

Upgrade the Next.js frontend from the current mock/placeholder state to the full Solana-anchored verifiable computation dashboard specified in §8 of `Implementation_plan.md`.

The user should be able to:
1. Connect a Phantom/Solflare wallet on Solana devnet.
2. Select a rule set (e.g. Payroll), enter inputs, preview the canonical JSON and SHA-256 hashes, and sign the on-chain `create_request` transaction.
3. Watch the request lifecycle progress in real time via Supabase Realtime (Open → Claimed → Receipt → Attestations → Finalized).
4. **Click "Verify in my browser"** to re-run the WASM directly in the browser's JavaScript environment and confirm that their hash matches the on-chain receipt without trusting the server.
5. Inspect the audit log with direct links to Solana Explorer transactions.

---

## 2. Step 1: Install Required Dependencies

Inside `frontend/`:

```powershell
cd d:\Projects\verity\frontend
pnpm add @solana/web3.js @solana/wallet-adapter-base @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets @coral-xyz/anchor bn.js @supabase/supabase-js @supabase/ssr qrcode.react sonner @tanstack/react-query
```

Ensure `package.json` includes `@solana/wallet-adapter-react-ui/styles.css` imports.

---

## 3. Step 2: Environment Variables & IDL

### 3.1 Create `frontend/.env.local`
```ini
NEXT_PUBLIC_SUPABASE_URL=https://[YOUR-PROJECT-REF].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[YOUR-SUPABASE-ANON-KEY]
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1
NEXT_PUBLIC_CLUSTER=devnet
```

### 3.2 Copy the Anchor IDL
Ensure the IDL file exists at `frontend/src/idl/verity_core.json`:
```powershell
New-Item -ItemType Directory -Force -Path d:\Projects\verity\frontend\src\idl
Copy-Item d:\Projects\verity\programs\verity_core\idl\verity_core.json d:\Projects\verity\frontend\src\idl\verity_core.json
```

---

## 4. Step 3: Implement In-Browser WASM Re-execution (`src/lib/verify.ts`)

This is the central wow-factor feature of Verity: zero-trust client-side verification.

Create [`frontend/src/lib/verify.ts`](file:///d:/Projects/verity/frontend/src/lib/verify.ts):

```typescript
export interface VerificationResult {
  ok: boolean;
  status: "MATCH" | "PROGRAM_TAMPERED" | "INPUT_TAMPERED" | "OUTPUT_MISMATCH" | "ERROR";
  programHashComputed: string;
  inputHashComputed: string;
  outputHashComputed?: string;
  expectedOutputHash: string;
  outputData?: any;
  error?: string;
}

// Convert ArrayBuffer to hex string
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Canonical SHA-256 using browser Web Crypto API
async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(hashBuffer);
}

export async function verifyInBrowser(
  wasmUrl: string,
  inputUrl: string,
  chainCommitments: {
    programHash: string;
    inputHash: string;
    outputHash: string;
  }
): Promise<VerificationResult> {
  try {
    // 1. Fetch WASM and canonical input blob
    const [wasmRes, inputRes] = await Promise.all([fetch(wasmUrl), fetch(inputUrl)]);
    if (!wasmRes.ok || !inputRes.ok) {
      return {
        ok: false,
        status: "ERROR",
        programHashComputed: "",
        inputHashComputed: "",
        expectedOutputHash: chainCommitments.outputHash,
        error: "Failed to download execution artifacts from storage",
      };
    }

    const wasmBytes = new Uint8Array(await wasmRes.arrayBuffer());
    const inputText = await inputRes.text();
    const inputBytes = new TextEncoder().encode(inputText);

    // 2. Verify Program Hash integrity
    const computedProgramHash = await sha256(wasmBytes);
    if (computedProgramHash.toLowerCase() !== chainCommitments.programHash.toLowerCase()) {
      return {
        ok: false,
        status: "PROGRAM_TAMPERED",
        programHashComputed: computedProgramHash,
        inputHashComputed: "",
        expectedOutputHash: chainCommitments.outputHash,
        error: `WASM binary hash mismatch! Chain: ${chainCommitments.programHash.slice(0, 10)}... Computed: ${computedProgramHash.slice(0, 10)}...`,
      };
    }

    // 3. Verify Input Hash integrity
    const computedInputHash = await sha256(inputBytes);
    if (computedInputHash.toLowerCase() !== chainCommitments.inputHash.toLowerCase()) {
      return {
        ok: false,
        status: "INPUT_TAMPERED",
        programHashComputed: computedProgramHash,
        inputHashComputed: computedInputHash,
        expectedOutputHash: chainCommitments.outputHash,
        error: `Input data hash mismatch! Chain: ${chainCommitments.inputHash.slice(0, 10)}... Computed: ${computedInputHash.slice(0, 10)}...`,
      };
    }

    // 4. Instantiate WebAssembly (No imports required -> purely deterministic)
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as any;

    if (!exports.alloc || !exports.compute || !exports.memory) {
      throw new Error("WASM module does not conform to Verity ABI (missing alloc/compute/memory)");
    }

    // 5. Allocate memory and copy input
    const inputPtr = exports.alloc(inputBytes.length);
    const memory = new Uint8Array(exports.memory.buffer);
    memory.set(inputBytes, inputPtr);

    // 6. Execute computation
    const outPtr = exports.compute(inputPtr, inputBytes.length);
    if (outPtr === 0) {
      throw new Error("WASM compute returned null pointer (invalid input format)");
    }

    // 7. Read output buffer: [4 bytes length LE] || [output bytes]
    const view = new DataView(exports.memory.buffer);
    const outLen = view.getUint32(outPtr, true);
    const outBytes = new Uint8Array(exports.memory.buffer, outPtr + 4, outLen);
    const outText = new TextDecoder().decode(outBytes);

    // 8. Hash output and compare with chain commitment
    const computedOutputHash = await sha256(outBytes);
    const isMatch = computedOutputHash.toLowerCase() === chainCommitments.outputHash.toLowerCase();

    return {
      ok: isMatch,
      status: isMatch ? "MATCH" : "OUTPUT_MISMATCH",
      programHashComputed: computedProgramHash,
      inputHashComputed: computedInputHash,
      outputHashComputed: computedOutputHash,
      expectedOutputHash: chainCommitments.outputHash,
      outputData: JSON.parse(outText),
    };
  } catch (err: any) {
    return {
      ok: false,
      status: "ERROR",
      programHashComputed: "",
      inputHashComputed: "",
      expectedOutputHash: chainCommitments.outputHash,
      error: err.message || "Execution exception in browser WebAssembly",
    };
  }
}
```

---

## 5. Step 4: Solana & Anchor Client Helper (`src/lib/solana.ts`)

Create [`frontend/src/lib/solana.ts`](file:///d:/Projects/verity/frontend/src/lib/solana.ts):

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import idl from "@/idl/verity_core.json";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1"
);
export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";

export function getProvider(wallet: any) {
  const connection = new Connection(RPC_URL, "confirmed");
  return new AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

export function getProgram(wallet: any) {
  const provider = getProvider(wallet);
  return new Program(idl as any, provider);
}

// PDAs
export function getConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
}

export function getRequestPda(requester: PublicKey, id: number | BN): [PublicKey, number] {
  const idBn = new BN(id);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("request"), requester.toBuffer(), idBn.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
}

export function getReceiptPda(requestPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("receipt"), requestPda.toBuffer()], PROGRAM_ID);
}

export function getDisputePda(requestPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("dispute"), requestPda.toBuffer()], PROGRAM_ID);
}
```

---

## 6. Step 5: Required UI Pages

Implement the following pages in `frontend/src/app/`:

### 1. `frontend/src/app/page.tsx` (Landing Page)
* High-impact hero section: *"Prove the computation, not just the result."*
* Live Network Stats fetched from `GET ${NEXT_PUBLIC_API_URL}/stats`:
  * Total Requests, Verified %, Slashed Disputes, Registered Verifiers.
* Architecture interactive diagram (Requester → Provider → Verifiers → Dispute).
* Quick action CTAs: "Explore Rulesets" & "Launch Computation".

### 2. `frontend/src/app/rulesets/page.tsx` (Marketplace)
* Fetches all registered rule sets from `GET /programs`.
* Displays interactive cards for **Payroll** and **Credit Risk**.
* Displays JSON Schema preview, input parameters, and a "Run This Program" button that routes to `/requests/new?program=<hash>`.

### 3. `frontend/src/app/requests/new/page.tsx` (Create Request)
* Allows user to select a rule set.
* Generates an interactive form based on the rule set's `input_schema`.
* Real-time preview of canonical JSON and SHA-256 `input_hash`.
* Form submission flow:
  1. Calls `POST /requests/prepare` with `{program_hash, input}` to canonicalize and store the input blob.
  2. Builds and signs `create_request` transaction with the user's Phantom/Solflare wallet using Anchor:
     ```ts
     await program.methods
       .createRequest(
         Array.from(Buffer.from(programHash, "hex")),
         Array.from(Buffer.from(inputHash, "hex")),
         Array.from(Buffer.from(uriHash, "hex")),
         new BN(bountyLamports),
         new BN(deadlineTimestamp)
       )
       .accounts({ requester: wallet.publicKey, config, request: requestPda, systemProgram })
       .rpc();
     ```
  3. Calls `POST /requests/confirm` to index the job immediately.
  4. Redirects to `/requests/[pda]`.

### 4. `frontend/src/app/requests/[pda]/page.tsx` (THE HERO PAGE)
The primary demonstration view for judges:
* **Lifecycle Stepper:** Visual status indicators (`Open` → `Claimed` → `AwaitingVerification` → `Verified` / `Rejected`).
* **Artifacts & Integrity Card:**
  * Displays Program WASM, Input JSON, and Output JSON with download links.
  * Live SHA-256 client recalculation: shows badge `Matches Chain ✅` or `TAMPERED ❌`.
* **Receipt & Signature Card:**
  * Provider Pubkey, Output Hash, Fuel Used, Trace Merkle Root.
  * Green Ed25519 signature verified badge.
* **Independent Attestations Card:**
  * List of registered verifiers that re-executed the job.
  * Consensus quorum progress bar (e.g. `2 / 2 required match attestations`).
* **⭐ In-Browser Verification Action:**
  * Prominent button: **"Run Local Verification in My Browser"**.
  * Executes `verifyInBrowser(wasmUrl, inputUrl, chainCommitments)` client-side.
  * Displays an animated modal showing WASM loading → input parsing → local execution → SHA-256 comparison.
  * Confirms: *"Output hash matches chain receipt bit-for-bit. Verified on your local device without trusting server infrastructure."*
* **Dispute & Slashing Panel:**
  * Shows challenge status if disputed.
  * Slashing details (challenger reward + verifier payouts).
* **Chronological Audit Timeline:**
  * Every on-chain event linked directly to Solana Explorer:
    `https://explorer.solana.com/tx/<tx_sig>?cluster=devnet`.
* **Download Button:**
  * Downloads `evidence.zip` (containing wasm, input, output, signatures, and chain receipts).

### 5. `frontend/src/app/verify/[pda]/page.tsx` (Public Standalone Verification)
* Lightweight public page requiring **no login and no wallet connection**.
* Shows the request status and automatically executes `verifyInBrowser` on load.
* Displays a QR code that allows anyone with a mobile phone to scan and verify the computation directly on their phone browser.

---

## 7. Verification Checklist

1. Start frontend: `pnpm run dev`.
2. Connect Phantom wallet switched to **Solana Devnet**.
3. Create a Payroll computation request.
4. Verify the request appears in `/requests/[pda]` and moves from `Open` to `Claimed` to `Verified`.
5. Click **"Run Local Verification in My Browser"** and verify that it turns green with bit-identical hash matching.
