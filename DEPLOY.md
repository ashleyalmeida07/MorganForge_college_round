# Deploying Verity (Vercel + Render + Supabase, Solana devnet)

| Piece | Where | Config file |
|---|---|---|
| Next.js frontend | Vercel (Hobby), root directory `frontend` | `frontend/vercel.json` |
| FastAPI API + workers | Render (free web service), root directory `backend` | `render.yaml` (repo root) |
| Postgres, Auth, Storage, Realtime | a **separate production** Supabase project | `supabase/migrations/*.sql` |
| `verity_core` + `verity_zk_verifier` | Solana devnet, already deployed | `programs/verity_core/DEPLOYMENT.md` |

Local development keeps using `backend/.env` + `frontend/.env.local` (your dev Supabase project).
The deployment uses its own Supabase project. Both talk to the **same devnet programs** with the
**same service keypairs**: there is nothing to redeploy on-chain.

Do the steps in order. Each one needs URLs or keys from the step before it.

---

## 1. Production Supabase project

1. Create a new project at supabase.com. Pick the region **Southeast Asia (Singapore)** so it is
   close to the Render service (`region: singapore` in `render.yaml`).
2. **Keys.** Project Settings → API Keys → *Legacy API keys*: copy the `anon` and
   `service_role` keys. Project Settings → JWT Keys: copy the *Legacy JWT secret*. The backend
   also accepts the new asymmetric signing keys via JWKS, so the secret is only a fast path.
3. **Database URL.** Connect → *Session pooler* (port 5432, works over IPv4): copy the URI.
4. **Schema + rule sets.** Run these from your PC against the production project:

   ```bash
   cd backend
   cp .env.production.example .env.production      # gitignored: fill in the values from steps 2-3
   # bash / Git Bash:
   VERITY_ENV_FILE=.env.production python scripts/apply_migration.py
   VERITY_ENV_FILE=.env.production python scripts/seed_rulesets.py
   ```

   ```powershell
   # PowerShell
   cd backend
   $env:VERITY_ENV_FILE = ".env.production"
   python scripts/apply_migration.py
   python scripts/seed_rulesets.py
   Remove-Item Env:VERITY_ENV_FILE                 # back to the dev database
   ```

   `VERITY_ENV_FILE` is read last, so its values override `backend/.env`. Keys you leave out of it
   (keypairs, RPC) come from `backend/.env`. The migration creates the tables, RLS, the audit
   trigger, the storage buckets (`programs`, `inputs`, `outputs`) and the Realtime publication.
   The seed uploads the committed `rulesets/*/*.wasm`. Do **not** run `bootstrap_chain.py`: the
   devnet config, provider stake and verifiers are already on chain and shared.
5. **Auth.** Authentication → Sign In / Providers:
   - **Email**: on by default.
   - **Google**: paste the client ID and secret of your Google OAuth client. In Google Cloud
     Console, add `https://<prod-ref>.supabase.co/auth/v1/callback` to that client's
     *Authorized redirect URIs*, next to the dev project's callback.
   - Authentication → URL Configuration: set this after step 3, once you have the Vercel URL.

## 2. Backend on Render

1. Render → **New → Blueprint** → pick this repo. Render reads `render.yaml` and creates the free
   web service `verity-api` (`rootDir: backend`, Python 3.11.9, one uvicorn worker, `/health`
   health check, auto-deploy on every commit to `main`).
2. Fill in the prompted (`sync: false`) values:

   | Variable | Value |
   |---|---|
   | `PROVIDER_KEYPAIR_JSON`, `VERIFIER_KEYPAIRS_JSON`, `ADMIN_KEYPAIR_JSON` | the same values as in `backend/.env` (JSON arrays paste as-is) |
   | `REQUESTER_KEYPAIR_JSON` | optional; a funded devnet key for the `/admin` simulation lab |
   | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | the **production** project (step 1) |
   | `FRONTEND_ORIGIN` | for now `http://localhost:3000`; change it to the Vercel URL in step 3 |
   | `FRONTEND_ORIGIN_REGEX` | `https://verity[a-z0-9-]*\.vercel\.app` (your project's preview URLs), or empty |
   | `PINATA_JWT`, `PINATA_GATEWAY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY` | optional, or leave empty |

   Leave `DEV_ADMIN_TOKEN` unset on Render.
3. When the deploy is live, open `https://<service>.onrender.com/health` (`"ok": true`,
   `workers_enabled: true`) and `/config`, which should list the provider and 3 verifier pubkeys.
   The first build takes a few minutes; later cold starts take about 30–60 s.

## 3. Frontend on Vercel

1. Vercel → **Add New → Project** → import this repo → **Root Directory: `frontend`**. The
   framework, install command (`npm ci`) and build command come from `frontend/vercel.json`.
2. Environment variables (Production and Preview):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<service>.onrender.com` (no trailing slash) |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **production** project |
   | `NEXT_PUBLIC_SOLANA_RPC` | `https://api.devnet.solana.com` (or a Helius devnet URL) |
   | `NEXT_PUBLIC_PROGRAM_ID` | `ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1` |
   | `NEXT_PUBLIC_ZK_PROGRAM_ID` | `A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv` |
   | `NEXT_PUBLIC_CLUSTER` | `devnet` |

   The build fails if `NEXT_PUBLIC_API_URL` or either Supabase variable is missing. These
   values are baked in at build time, so **redeploy** after changing any of them.
3. Deploy. Then wire the URL back:
   - **Render** → `verity-api` → Environment: `FRONTEND_ORIGIN=https://<app>.vercel.app`
     (comma-separate any custom domain). Saving restarts the service.
   - **Supabase (prod)** → Authentication → URL Configuration: **Site URL**
     `https://<app>.vercel.app`; **Redirect URLs** `https://<app>.vercel.app/**`, plus
     `https://verity-*-<team>.vercel.app/**` if you want logins on preview deployments.
   - **Google Cloud** → OAuth client → *Authorized JavaScript origins*: add `https://<app>.vercel.app`.

## 4. Keep the API awake

Render's free tier sleeps after 15 minutes without traffic, and while it sleeps the provider,
verifier and finalizer workers are stopped too. In GitHub → Settings → Secrets and variables →
Actions → **Variables**, add `RENDER_API_URL=https://<service>.onrender.com`.
`.github/workflows/keepalive.yml` then pings `/health` every 10 minutes. GitHub can delay
scheduled runs, so for a demo also add a cron-job.org (or UptimeRobot) monitor on the same URL,
and open the site a few minutes before presenting. One always-on free service uses about 744 of
Render's 750 free instance-hours per month.

## 5. Running local and deployed at the same time

Both backends watch the same devnet program. Each backend **only claims and verifies requests
whose requester-signed input commitment is in its own database**. That row is written before
`create_request` is sent, so a deployment never touches a job whose blobs live in the other
deployment's storage. Shared on purpose:

- **On-chain state.** Provider stake, slashing, reputation and verifier records are the same
  in both environments, because the keypairs are the same.
- **Activity feed.** Each indexer mirrors every devnet event of the program. Requests created
  through the other environment show up in the feed, but their artifacts (input/output blobs)
  only load in the environment that created them.

Not shared: users and logins (separate Supabase Auth), chaos flags, the audit log hash chain, and
uploaded rule sets. Upload a new rule set to both environments if you want it in both.

## 6. Smoke test on the deployed URLs

1. Open `https://<app>.vercel.app`. The landing stats load (if not, the API is cold or CORS is
   wrong: check `FRONTEND_ORIGIN`).
2. Sign up with email or Google. You should land on `/dashboard`. An email in `ADMIN_EMAILS` also
   sees `/admin`.
3. Connect Phantom (devnet) → link the wallet → `/create-job` → payroll → submit. Within about
   30 s the request goes Open → Claimed → AwaitingVerification → Verified (on a cold start, the
   first tick waits for the service to wake).
4. On the request page, run **Verify in my browser** and download `evidence.zip`.
5. `/admin` → **Run all scenarios** (needs a funded `REQUESTER_KEYPAIR_JSON` or admin key).

Optional: run the devnet E2E suite against the deployment (Actions → ci → Run workflow,
`e2e = true`, with the repo secrets `VERITY_API_URL`, `VERITY_ADMIN_TOKEN` (an admin user's
Supabase access token), `REQUESTER_KEYPAIR_JSON` and `PROVIDER_KEYPAIR_JSON`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser console: CORS error | `FRONTEND_ORIGIN` must exactly match the site origin (scheme + host, no trailing slash) |
| Google login returns to `localhost` | Supabase (prod) Site URL / Redirect URLs still point at localhost |
| "invalid or expired token" from the API | Render's `SUPABASE_*` values point at a different project than Vercel's `NEXT_PUBLIC_SUPABASE_*` |
| Wallet link: domain mismatch | the site's origin is in neither `FRONTEND_ORIGIN` nor `FRONTEND_ORIGIN_REGEX` |
| Requests stay Open | the service is asleep, or `/health` → `worker_status` shows RPC 429s (use a Helius devnet RPC) |
| Rule set list is empty | `seed_rulesets.py` was not run with `VERITY_ENV_FILE=.env.production` |
| Vercel build: "Missing NEXT_PUBLIC_…" | add the variable for that environment (Production / Preview), then redeploy |
