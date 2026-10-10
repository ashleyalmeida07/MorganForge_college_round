"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";

import { env } from "@/lib/env";

/** Solana connection + wallet context. Wallets (Phantom, Solflare, Backpack…) are auto-detected via Wallet Standard. */
export function SolanaProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={env.solanaRpc} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
