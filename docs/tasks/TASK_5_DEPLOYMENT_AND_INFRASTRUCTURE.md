# Task 05: Production Deployment & Infrastructure

> **Priority:** P1 (Required for Live Hackathon Submission)  
> **Estimated Time:** 1–1.5 hours  
> **Dependencies:** [TASK_1_SUPABASE_DATABASE_SETUP.md](./TASK_1_SUPABASE_DATABASE_SETUP.md), [TASK_2_WASM_RULESETS.md](./TASK_2_WASM_RULESETS.md), [TASK_3_FRONTEND_IMPLEMENTATION.md](./TASK_3_FRONTEND_IMPLEMENTATION.md), [TASK_4_ADVERSARIAL_DEMO_AND_ADMIN.md](./TASK_4_ADVERSARIAL_DEMO_AND_ADMIN.md)  
> **Target Files:** [`backend/render.yaml`](file:///d:/Projects/verity/backend/render.yaml), [`frontend/`](file:///d:/Projects/verity/frontend)

---

## 1. Overview

To satisfy the hackathon judging criteria, Verity must run live on accessible public URLs:
* **Frontend:** Deployed to **Vercel** (Next.js free tier).
* **Backend:** Deployed to **Render** (FastAPI Web Service free tier).
* **Database & Storage:** Hosted on **Supabase** (Postgres + Storage + Realtime).
* **Blockchain:** Anchored on **Solana Devnet** (`verity_core` program).

---

## 2. Step 1: Deploy Backend to Render (Free Tier)

### 2.1 Using the Blueprint File (`backend/render.yaml`)
1. Log in to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New** → **Blueprint**.
3. Connect your GitHub repository.
4. Set the **Blueprint Path** to `backend/render.yaml`.
5. Render will automatically parse the service configuration:
   * **Name:** `verity-api`
   * **Runtime:** Python 3.11.9
   * **Root Directory:** `backend`
   * **Build Command:** `pip install -r requirements.txt`
   * **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1`
   * **Health Check Path:** `/health`

### 2.2 Configure Environment Variables in Render Dashboard
Provide the following environment variables (set in the Render dashboard):

| Variable | Value / Format |
|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` (or your Helius Devnet RPC URL) |
| `PROGRAM_ID` | `ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1` |
| `CLUSTER` | `devnet` |
| `PROVIDER_KEYPAIR_JSON` | 64-byte secret key JSON array or base64 string from `backend/keys/provider.json` |
| `VERIFIER_KEYPAIRS_JSON` | JSON array containing the 3 verifier keypairs |
| `ADMIN_KEYPAIR_JSON` | Keypair for the config authority (`backend/keys/deployer.json`) |
| `SUPABASE_URL` | `https://[YOUR-PROJECT-REF].supabase.co` |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role secret (bypasses RLS) |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret |
| `FRONTEND_ORIGIN` | `http://localhost:3000,https://[YOUR-VERCEL-DOMAIN].vercel.app` |
| `WORKERS_ENABLED` | `true` |
| `ADMIN_EMAILS` | `support@arhamfintech.ai` (comma-separated admin emails) |

### 2.3 Set Up Keep-Alive Monitor (Prevent Free-Tier Cold Starts)
Render's free tier spins down after 15 minutes of inactivity. During judge presentations, a cold start takes 45–60 seconds.
1. Go to [cron-job.org](https://cron-job.org) or [UptimeRobot](https://uptimerobot.com) (both free).
2. Create a new HTTP monitor pointing to:
   ```
   https://<YOUR-RENDER-APP>.onrender.com/health
   ```
3. Set the polling schedule to **every 10 minutes**.

---

## 3. Step 2: Deploy Frontend to Vercel

1. Log in to [Vercel](https://vercel.com/) and click **Add New** → **Project**.
2. Select your GitHub repository.
3. Configure the Project Settings:
   * **Framework Preset:** Next.js
   * **Root Directory:** `frontend`
4. Expand **Environment Variables** and add:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://[YOUR-PROJECT-REF].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[YOUR-SUPABASE-ANON-KEY]
NEXT_PUBLIC_API_URL=https://[YOUR-RENDER-APP].onrender.com
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1
NEXT_PUBLIC_CLUSTER=devnet
```

5. Click **Deploy**.

### 3.3 Post-Deployment Origin Wiring
1. Copy your live Vercel domain (e.g. `https://verity-compute.vercel.app`).
2. In your Render Dashboard, add this domain to the `FRONTEND_ORIGIN` variable.
3. In your Supabase Dashboard (**Authentication** → **URL Configuration**), add `https://verity-compute.vercel.app/**` to the **Redirect URLs**.

---

## 4. Step 3: Solana Devnet Account Balances & Faucets

Ensure the backend worker keypairs maintain sufficient SOL on devnet for paying transaction fees (claim, receipt, attest, finalize):

| Keypair | Recommended Min Balance | Purpose |
|---|---|---|
| Provider (`provider.json`) | ≥ 0.5 SOL | Submitting execution receipts |
| Verifier 1 (`verifier1.json`) | ≥ 0.3 SOL | Submitting attestations |
| Verifier 2 (`verifier2.json`) | ≥ 0.3 SOL | Submitting attestations |
| Verifier 3 (`verifier3.json`) | ≥ 0.3 SOL | Submitting attestations |
| Admin / Deployer | ≥ 1.0 SOL | Anchoring audit roots on-chain |

### Top-Up Faucets:
* Web Faucet: [https://faucet.solana.com](https://faucet.solana.com)
* CLI Airdrop:
  ```powershell
  solana airdrop 2 <PUBKEY> --url https://api.devnet.solana.com
  ```

---

## 5. End-to-End Verification Checklist

Perform these sanity checks on the deployed URLs before the hackathon submission:

* [ ] `GET https://<RENDER-APP>.onrender.com/health` returns `{"status": "ok", "workers": true}`.
* [ ] `GET https://<RENDER-APP>.onrender.com/config` returns correct `program_id` and config authority.
* [ ] Open `https://<VERCEL-APP>.vercel.app` in an incognito window.
* [ ] Connect Phantom wallet on Solana Devnet.
* [ ] Create a computation request on the live site.
* [ ] Confirm that the timeline animates and reaches `Verified` on devnet without manual backend intervention.
* [ ] Click "Verify in my browser" on the live site and ensure green confirmation.
