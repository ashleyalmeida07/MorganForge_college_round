"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { getSupabase } from "@/lib/supabase/client";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    window.location.href = "/";
  }, []);

  const value = useMemo<AuthState>(() => {
    const user = session?.user ?? null;
    const meta = (user?.user_metadata ?? {}) as Record<string, string | undefined>;
    return {
      user,
      session,
      loading,
      displayName: meta.full_name ?? meta.name ?? user?.email ?? null,
      avatarUrl: meta.avatar_url ?? meta.picture ?? null,
      signOut,
    };
  }, [session, loading, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
