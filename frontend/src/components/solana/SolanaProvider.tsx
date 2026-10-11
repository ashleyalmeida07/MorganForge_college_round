"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";

import { env } from "@/lib/env";

/**
 * Solana connection + wallet context.
 * Phantom, Solflare, Backpack and all other Wallet-Standard wallets are
 * auto-detected — no explicit adapter registration is needed.
 */
export function SolanaProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={env.solanaRpc} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
