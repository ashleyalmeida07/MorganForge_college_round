# Task 01: Supabase Database Setup & Migration

> **Priority:** P0 (Blocker)  
> **Estimated Time:** 20–30 minutes  
> **Dependencies:** None  
> **Target Files:** [`supabase/migrations/0001_init.sql`](file:///d:/Projects/verity/supabase/migrations/0001_init.sql), [`backend/scripts/apply_migration.py`](file:///d:/Projects/verity/backend/scripts/apply_migration.py), [`backend/.env`](file:///d:/Projects/verity/backend/.env)

---

## 1. Problem & Context

The backend codebase is fully implemented, but when it attempts to query Supabase, PostgREST returns:
```
postgrest.exceptions.APIError: {'message': "Could not find the table 'public.requests' in the schema cache", 'code': 'PGRST205'}
```
This indicates that the initial SQL migration has **not yet been applied** to the active Supabase project. Until this migration runs, neither the FastAPI backend nor the frontend can read or write requests, receipts, attestations, audit logs, or storage blobs.

---

## 2. Step-by-Step Execution

### Option A: Via Supabase Web Dashboard (Recommended & Fastest)

1. Open your Supabase project dashboard: [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. In the left navigation, click **SQL Editor**.
3. Click **New Query**.
4. Open [`supabase/migrations/0001_init.sql`](file:///d:/Projects/verity/supabase/migrations/0001_init.sql) in your code editor, copy the entire file contents, and paste it into the Supabase SQL editor.
5. Click **Run** (Ctrl + Enter).
6. Ensure the result message shows `Success. No rows returned`.

---

### Option B: Via Backend Python Script

1. In your Supabase Dashboard, navigate to **Project Settings** → **Database**.
2. Scroll to **Connection string** → **URI**.
3. Copy the URI (either direct port 5432 or transaction pooler port 6543). Replace `[YOUR-PASSWORD]` with your actual database password.
4. Add or update `DATABASE_URL` in `backend/.env`:
   ```bash
   DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
   ```
5. From the repository root, run:
   ```powershell
   cd backend
   .\.venv\Scripts\python scripts/apply_migration.py
   ```
6. The script should print:
   ```
   applying migration 0001_init.sql ... done
   migration complete
   ```

---

## 3. Storage Buckets Verification

The migration script includes SQL commands to create three storage buckets (`programs`, `inputs`, `outputs`). Verify them in the dashboard:

1. In Supabase Dashboard, go to **Storage**.
2. Verify that the following 3 buckets exist:
   * `programs` (Public bucket — stores WASM binaries and source text)
   * `inputs` (Public bucket — stores canonical JSON inputs)
   * `outputs` (Public bucket — stores execution output JSON blobs)
3. If any bucket is missing, click **New Bucket**, name it, and toggle **Public bucket** ON.

---

## 4. Supabase Authentication Setup

The application uses Google OAuth (handled by Supabase Auth) and Sign-In-With-Solana (SIWS) wallet linking.

1. Go to **Authentication** → **Providers** → **Google**:
   * Enable Google provider.
   * Provide your Google Cloud OAuth **Client ID** and **Client Secret**.
   * Note the Callback URL: `https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback` and add it to your Google Cloud Console Authorized redirect URIs.
2. Go to **Authentication** → **URL Configuration**:
   * Set **Site URL** to `http://localhost:3000` (or your Vercel URL once deployed).
   * In **Redirect URLs**, add:
     * `http://localhost:3000/**`
     * `http://localhost:3000/auth/callback`
     * `https://*.vercel.app/**`

---

## 5. Verification Checklist

Run this quick test command to confirm that the backend can connect, query tables, and access storage:

```powershell
cd d:\Projects\verity\backend
.\.venv\Scripts\python -c "from app.db import table, BUCKET_PROGRAMS, get_storage; print('Requests count:', table('requests').select('request_pda', count='exact').limit(1).execute().count); print('Chaos flags:', table('chaos_flags').select('*').execute().data)"
```

### Expected Output:
```
Requests count: 0 (or integer >= 0)
Chaos flags: [{'name': 'PROVIDER_TAMPER_OUTPUT', 'enabled': False, ...}, ...]
```

If this command succeeds without errors, Task 01 is complete! Proceed to **Task 02**.
