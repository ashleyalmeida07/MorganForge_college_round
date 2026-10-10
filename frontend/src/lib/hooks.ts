"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

/** Minimal GET hook against the backend. Pass `null` to skip. Optional polling interval (ms). */
export function useApi<T>(path: string | null, pollMs?: number) {
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

  useEffect(() => {
    if (!path) return;
    load();
    if (!pollMs) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [path, pollMs, load]);

  return { data, error, loading, reload: load };
}
