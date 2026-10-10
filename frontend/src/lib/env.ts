// Public runtime configuration. NEXT_PUBLIC_* vars must be referenced literally so Next inlines them.
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, ""),
  solanaRpc: process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com",
  programId: process.env.NEXT_PUBLIC_PROGRAM_ID ?? "ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1",
  zkProgramId: process.env.NEXT_PUBLIC_ZK_PROGRAM_ID ?? "A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv",
  cluster: process.env.NEXT_PUBLIC_CLUSTER ?? "devnet",
};

export function explorerTx(sig?: string | null) {
  return sig ? `https://explorer.solana.com/tx/${sig}?cluster=${env.cluster}` : null;
}

export function explorerAddress(addr?: string | null) {
  return addr ? `https://explorer.solana.com/address/${addr}?cluster=${env.cluster}` : null;
}
