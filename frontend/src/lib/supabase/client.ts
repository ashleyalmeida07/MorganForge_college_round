import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

let client: SupabaseClient | undefined;

/** Browser Supabase client (singleton). Session is kept in cookies so the proxy can read it. */
export function getSupabase(): SupabaseClient {
  if (!client) client = createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
  return client;
}
