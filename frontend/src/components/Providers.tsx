"use client";

import { AuthProvider } from "@/components/auth/AuthProvider";
import { SolanaProvider } from "@/components/solana/SolanaProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SolanaProvider>{children}</SolanaProvider>
    </AuthProvider>
  );
}
