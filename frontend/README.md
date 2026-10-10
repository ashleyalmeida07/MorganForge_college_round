# Verity — frontend

Next.js 16 (App Router) · Supabase Auth (Google + email) · Solana wallet adapter · Anchor client for `verity_core` · Verity FastAPI backend.

## Run

```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev                  # http://localhost:3000
```

## Environment

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project (anon key only) |
| `NEXT_PUBLIC_API_URL` | FastAPI backend base URL |
| `NEXT_PUBLIC_SOLANA_RPC` | Solana RPC (devnet) |
| `NEXT_PUBLIC_PROGRAM_ID` | `verity_core` program id |
| `NEXT_PUBLIC_CLUSTER` | `devnet` (explorer links) |

Supabase dashboard setup: enable **Authentication → Providers → Google**, and add `http://localhost:3000/auth/callback` (plus your Vercel URL + `/auth/callback`) to **Authentication → URL Configuration → Redirect URLs**.

## Layout

```
src/
  proxy.ts                    session refresh + route guard (/dashboard, /create-job, /provider)
  app/auth/callback/route.ts  OAuth / email-confirm code exchange
  components/auth/AuthProvider.tsx     useAuth(): user, session, signOut
  components/solana/SolanaProvider.tsx connection + wallet context
  components/solana/WalletButton.tsx   connect wallet + link it to the account (signed nonce)
  lib/api.ts       typed backend client (adds Supabase bearer token)
  lib/hooks.ts     useApi(path, pollMs), useVerityProgram()
  lib/solana.ts    PDAs + createRequest / openDispute / registerAndStakeProvider
  lib/hash.ts      canonical JSON + SHA-256 (matches backend byte-for-byte)
  lib/verify.ts    in-browser WASM re-execution
  idl/             verity_core IDL (copied from programs/verity_core/idl)
```
