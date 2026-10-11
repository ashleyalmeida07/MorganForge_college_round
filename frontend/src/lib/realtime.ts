"use client";

// Supabase Realtime: push table changes to the UI instead of polling.
// The tables are published in supabase/migrations (0001 + 0003) and are publicly readable,
// so the anon key can subscribe. Pages poll only while the channel is not SUBSCRIBED
// (Realtime disabled, no Supabase env, network trouble).
import { useCallback, useEffect, useRef, useState } from "react";

import { env } from "@/lib/env";
import { getSupabase } from "@/lib/supabase/client";

export type LiveTable =
  | "requests"
  | "receipts"
  | "attestations"
  | "disputes"
  | "audit_log"
  | "providers"
  | "programs"
  | "chaos_flags";

/** A table to watch, optionally narrowed with a PostgREST-style filter, e.g. `request_pda=eq.<pda>`. */
export interface LiveSpec {
  table: LiveTable;
  filter?: string;
}

const DEBOUNCE_MS = 400;
let channelSeq = 0;

export const realtimeAvailable = () => Boolean(env.supabaseUrl && env.supabaseAnonKey);

/**
 * Calls `onChange` (debounced) whenever a row in any of `specs` is inserted, updated or deleted.
 * Returns true while the subscription is live. Pass null to disable.
 */
export function useLiveTables(specs: LiveSpec[] | null | undefined, onChange: () => void): boolean {
  const [live, setLive] = useState(false);
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);

  const key = specs?.length ? JSON.stringify(specs) : "";

  useEffect(() => {
    if (!key || !realtimeAvailable()) return;
    const wanted = JSON.parse(key) as LiveSpec[];
    const supabase = getSupabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), DEBOUNCE_MS);
    };

    let channel = supabase.channel(`verity-live-${++channelSeq}`);
    for (const s of wanted) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: s.table, ...(s.filter ? { filter: s.filter } : {}) },
        fire,
      );
    }
    channel.subscribe((status) => {
      const ok = status === "SUBSCRIBED";
      setLive(ok);
      if (ok) fire(); // catch anything that changed while (re)connecting
    });

    return () => {
      clearTimeout(timer);
      setLive(false);
      void supabase.removeChannel(channel);
    };
  }, [key]);

  return live;
}

/**
 * Current value of one chaos flag, read straight from the public `chaos_flags` table and kept
 * live via Realtime. Lets client-side attack paths (e.g. ZK_CORRUPT_PROOF in the zk panel)
 * follow the admin lab's switches without an admin token.
 */
export function useChaosFlag(name: string, active = true): boolean {
  const [enabled, setEnabled] = useState(false);
  const load = useCallback(async () => {
    if (!active || !realtimeAvailable()) return;
    const { data, error } = await getSupabase().from("chaos_flags").select("enabled").eq("name", name).maybeSingle();
    if (!error) setEnabled(Boolean(data?.enabled));
  }, [name, active]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveTables(active ? [{ table: "chaos_flags", filter: `name=eq.${name}` }] : null, load);
  return active && enabled;
}
