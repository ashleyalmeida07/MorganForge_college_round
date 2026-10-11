"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useLiveTables, type LiveSpec } from "@/lib/realtime";

export const LIVE_SAFETY_MS = 60_000;

/**
 * Minimal GET hook against the backend. Pass `null` to skip.
 * `live`: Supabase Realtime tables whose changes trigger a reload. While that subscription is up,
 * polling drops to a slow safety refresh (LIVE_SAFETY_MS, covers missed events); `pollMs` is the
 * interval when Realtime is unavailable, and the only refresh for endpoints that are not backed by
 * a table (e.g. /health).
 */
export function useApi<T>(path: string | null, pollMs?: number, live?: LiveSpec[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!path);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await apiGet<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [path]);

  const isLive = useLiveTables(path ? live : null, load);

  useEffect(() => {
    if (!path) return;
    load();
  }, [path, load]);

  useEffect(() => {
    if (!path || !pollMs) return;
    const t = setInterval(load, isLive ? Math.max(pollMs, LIVE_SAFETY_MS) : pollMs);
    return () => clearInterval(t);
  }, [path, pollMs, isLive, load]);

  return { data, error, loading, reload: load, live: isLive };
}
