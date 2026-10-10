// Shared helpers for devnet scripts.
// Env: DEPLOYER_KEYPAIR (path to solana-keygen JSON), RPC_URL (optional).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const { AnchorProvider, Program, Wallet, BN } = anchor;
export { BN, PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL };

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const KEYS_DIR = path.join(ROOT, "keys");
export const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

export function loadKeypair(p) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

/** Load keys/<name>.json, creating it if missing. */
export function namedKeypair(name) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const p = path.join(KEYS_DIR, `${name}.json`);
  if (!fs.existsSync(p)) {
    const kp = Keypair.generate();
    fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  }
  return loadKeypair(p);
}

export function setup() {
  const kpPath = process.env.DEPLOYER_KEYPAIR;
  if (!kpPath) throw new Error("Set DEPLOYER_KEYPAIR to the deployer keypair JSON path");
  const payer = loadKeypair(kpPath);
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/verity_core.json"), "utf8"));
  const program = new Program(idl, provider);
  return { payer, connection, provider, program, programId: program.programId };
}

export const enc = (s) => Buffer.from(s);
export const u64le = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
export const sha256 = (data) => crypto.createHash("sha256").update(data).digest();
export const arr = (buf) => Array.from(buf);

export function pdas(programId) {
  const f = (seeds) => PublicKey.findProgramAddressSync(seeds, programId)[0];
  return {
    config: () => f([enc("config")]),
    provider: (owner) => f([enc("provider"), owner.toBuffer()]),
    verifier: (v) => f([enc("verifier"), v.toBuffer()]),
    request: (requester, id) => f([enc("request"), requester.toBuffer(), u64le(id)]),
    receipt: (request) => f([enc("receipt"), request.toBuffer()]),
    attestation: (request, verifier) => f([enc("attestation"), request.toBuffer(), verifier.toBuffer()]),
    dispute: (request) => f([enc("dispute"), request.toBuffer()]),
  };
}

/** Canonical receipt bytes (must match on-chain receipt_message). */
export function receiptMessage(requestPda, programHash, inputHash, outputHash, traceRoot, fuelUsed) {
  return Buffer.concat([
    enc("VERITY_RECEIPT_V1"),
    requestPda.toBuffer(),
    programHash,
    inputHash,
    outputHash,
    traceRoot,
    u64le(fuelUsed),
  ]);
}

/** Ed25519 signature with a web3.js Keypair. */
export function ed25519Sign(kp, message) {
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(kp.secretKey.slice(0, 32)),
  ]);
  const key = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return crypto.sign(null, message, key);
}

export async function fundIfLow(connection, payer, to, minSol, topUpSol) {
  const bal = await connection.getBalance(to);
  if (bal >= minSol * LAMPORTS_PER_SOL) return bal;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: to,
      lamports: Math.round(topUpSol * LAMPORTS_PER_SOL),
    }),
  );
  await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
  return connection.getBalance(to);
}

export async function exists(connection, pubkey) {
  return (await connection.getAccountInfo(pubkey)) !== null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sol = (lamports) => (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4);
