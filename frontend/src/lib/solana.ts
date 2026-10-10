import { useMemo } from "react";
import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection, type AnchorWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey, type Connection } from "@solana/web3.js";

import { env } from "@/lib/env";
import idlJson from "@/idl/verity_core.json";
import type { VerityCore } from "@/idl/verity_core";

export const PROGRAM_ID = new PublicKey(env.programId);
export { LAMPORTS_PER_SOL };

const seed = (s: string) => new TextEncoder().encode(s);

function u64le(n: number | bigint | BN): Uint8Array {
  const v = BigInt(n.toString());
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
}

// ------------------------------------------------------------------ PDAs

export const configPda = () => PublicKey.findProgramAddressSync([seed("config")], PROGRAM_ID)[0];
export const providerPda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("provider"), owner.toBytes()], PROGRAM_ID)[0];
export const verifierPda = (verifier: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("verifier"), verifier.toBytes()], PROGRAM_ID)[0];
export const requestPda = (requester: PublicKey, id: number | bigint | BN) =>
  PublicKey.findProgramAddressSync([seed("request"), requester.toBytes(), u64le(id)], PROGRAM_ID)[0];
export const receiptPda = (request: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("receipt"), request.toBytes()], PROGRAM_ID)[0];
export const attestationPda = (request: PublicKey, verifier: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("attestation"), request.toBytes(), verifier.toBytes()], PROGRAM_ID)[0];
export const disputePda = (request: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("dispute"), request.toBytes()], PROGRAM_ID)[0];

// ------------------------------------------------------------------ program

export function getProgram(connection: Connection, wallet: AnchorWallet): Program<VerityCore> {
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  const idl = { ...(idlJson as Idl), address: PROGRAM_ID.toBase58() };
  return new Program(idl, provider) as unknown as Program<VerityCore>;
}

export function useVerityProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  return useMemo(() => (wallet ? getProgram(connection, wallet) : null), [connection, wallet]);
}

export async function fetchConfig(program: Program<VerityCore>) {
  return program.account.config.fetchNullable(configPda());
}

// ------------------------------------------------------------------ instructions

export interface CreateRequestArgs {
  programHash: number[];
  inputHash: number[];
  inputUriHash: number[];
  bountyLamports: number | bigint;
  deadlineUnix: number;
}

/** Signs + sends create_request with the connected wallet. Returns the request PDA and tx signature. */
export async function createRequest(program: Program<VerityCore>, args: CreateRequestArgs) {
  const requester = program.provider.publicKey!;
  const config = await fetchConfig(program);
  if (!config) throw new Error("verity_core config is not initialized on this cluster");
  const request = requestPda(requester, config.requestCount);

  const sig = await program.methods
    .createRequest(
      args.programHash,
      args.inputHash,
      args.inputUriHash,
      new BN(args.bountyLamports.toString()),
      new BN(args.deadlineUnix),
    )
    .accountsPartial({ config: configPda(), request, requester })
    .rpc();
  return { requestPda: request.toBase58(), signature: sig };
}

/** Opens a staked dispute against a receipt (challenger = connected wallet). */
export async function openDispute(program: Program<VerityCore>, request: PublicKey, claimedOutputHash: number[]) {
  const challenger = program.provider.publicKey!;
  return program.methods
    .openDispute(claimedOutputHash)
    .accountsPartial({
      config: configPda(),
      request,
      receipt: receiptPda(request),
      dispute: disputePda(request),
      challenger,
    })
    .rpc();
}

/** Registers the connected wallet as a provider (if needed) and stakes `lamports`. */
export async function registerAndStakeProvider(program: Program<VerityCore>, lamports: number | bigint) {
  const owner = program.provider.publicKey!;
  const provider = providerPda(owner);
  const sigs: string[] = [];
  const existing = await program.account.provider.fetchNullable(provider);
  if (!existing) {
    sigs.push(await program.methods.registerProvider().accountsPartial({ provider, owner }).rpc());
  }
  if (BigInt(lamports) > BigInt(0)) {
    sigs.push(
      await program.methods.stakeProvider(new BN(lamports.toString())).accountsPartial({ provider, owner }).rpc(),
    );
  }
  return sigs;
}

export const lamportsToSol = (l?: number | null) => (l ?? 0) / LAMPORTS_PER_SOL;
export const shortKey = (k?: string | null, n = 4) => (k ? `${k.slice(0, n)}…${k.slice(-n)}` : "—");
