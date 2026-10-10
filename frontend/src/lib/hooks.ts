"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";

import { apiGet } from "@/lib/api";
import { getProgram } from "@/lib/solana";

/** Minimal GET hook against the backend. Pass `null` to skip. Optional polling interval (ms). */
export function useApi<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!path);

  const load = useCallback(async () => {
    if (!path) return;
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
    setLoading(true);
    load();
    if (!pollMs) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [path, pollMs, load]);

  return { data, error, loading, reload: load };
}

/** Anchor program bound to the connected wallet (null until a wallet is connected). */
export function useVerityProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  return useMemo(() => (wallet ? getProgram(connection, wallet) : null), [connection, wallet]);
}
