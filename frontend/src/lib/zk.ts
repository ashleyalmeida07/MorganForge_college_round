// Groth16 zk proof of the payroll rule set: prove in the browser with snarkjs, verify
// on-chain with verity_zk_verifier. Mirrors zk/scripts/lib.mjs + the program's encodings.
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";

import { env } from "@/lib/env";
import { sha256, toHex, utf8 } from "@/lib/hash";
import { receiptPda } from "@/lib/solana";

export const ZK_PROGRAM_ID = new PublicKey(env.zkProgramId);
export const ZK_ASSETS = {
  snarkjs: "/zk/snarkjs.min.js",
  wasm: "/zk/payroll.wasm",
  zkey: "/zk/payroll_final.zkey",
  vkey: "/zk/verification_key.json",
};

export interface PayrollInput {
  salary_cents: number;
  tax_bps: number;
  deductions_cents: number;
}

export interface ZkProof {
  a: Uint8Array;
  b: Uint8Array;
  c: Uint8Array;
  tax: bigint;
  net: bigint;
  publicSignals: string[];
  proofJson: unknown;
  offchainValid: boolean;
  proveMs: number;
}

export interface ZkRecord {
  pda: string;
  request: string;
  prover: string;
  circuit: string;
  programHash: string;
  inputHash: string;
  receiptOutputHash: string;
  provenOutputHash: string;
  matchesReceipt: boolean;
  taxCents: bigint;
  netCents: bigint;
  verifiedAt: number;
  slot: bigint;
}

type Snarkjs = {
  groth16: {
    fullProve: (input: Record<string, string>, wasm: string, zkey: string) => Promise<{ proof: SnarkProof; publicSignals: string[] }>;
    verify: (vk: unknown, publicSignals: string[], proof: SnarkProof) => Promise<boolean>;
  };
};
type SnarkProof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

let snarkjsPromise: Promise<Snarkjs> | null = null;

/** snarkjs is loaded as its prebuilt browser bundle (keeps Node-only deps out of the Next bundle). */
export function loadSnarkjs(): Promise<Snarkjs> {
  const w = window as unknown as { snarkjs?: Snarkjs };
  if (w.snarkjs) return Promise.resolve(w.snarkjs);
  snarkjsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = ZK_ASSETS.snarkjs;
    s.async = true;
    s.onload = () => (w.snarkjs ? resolve(w.snarkjs) : reject(new Error("snarkjs failed to initialise")));
    s.onerror = () => {
      snarkjsPromise = null;
      reject(new Error("could not load snarkjs"));
    };
    document.head.appendChild(s);
  });
  return snarkjsPromise;
}

const be32 = (v: string | bigint) => {
  let n = BigInt(v);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & BigInt(0xff));
    n >>= BigInt(8);
  }
  return out;
};
const cat = (...p: Uint8Array[]) => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of p) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
const g1 = (p: string[]) => cat(be32(p[0]), be32(p[1]));
// Fp2 (c0 + c1*u) is encoded c1 || c0 for the alt_bn128 syscalls.
const g2 = (p: string[][]) => cat(be32(p[0][1]), be32(p[0][0]), be32(p[1][1]), be32(p[1][0]));

export function requestHalves(request: PublicKey): [string, string] {
  const b = request.toBytes();
  return [BigInt("0x" + toHex(b.slice(0, 16))).toString(), BigInt("0x" + toHex(b.slice(16))).toString()];
}

export const payrollInputJson = (i: PayrollInput) =>
  `{"deductions_cents":${i.deductions_cents},"salary_cents":${i.salary_cents},"tax_bps":${i.tax_bps}}`;
export const payrollOutputJson = (i: PayrollInput, tax: bigint, net: bigint) =>
  `{"deductions_cents":${i.deductions_cents},"gross_cents":${i.salary_cents},"net_cents":${net},"tax_cents":${tax}}`;

export function parsePayrollInput(v: unknown): PayrollInput | null {
  const o = v as Partial<PayrollInput> | null;
  if (!o || typeof o !== "object") return null;
  const keys = Object.keys(o).sort().join(",");
  if (keys !== "deductions_cents,salary_cents,tax_bps") return null;
  const ints = [o.salary_cents, o.tax_bps, o.deductions_cents].every((x) => Number.isSafeInteger(x) && (x as number) >= 0);
  return ints ? (o as PayrollInput) : null;
}

/** Generate a Groth16 proof bound to `request`, and check it off-chain first. */
export async function provePayroll(input: PayrollInput, request: PublicKey): Promise<ZkProof> {
  const snarkjs = await loadSnarkjs();
  const [hi, lo] = requestHalves(request);
  const t0 = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      salary_cents: String(input.salary_cents),
      tax_bps: String(input.tax_bps),
      deductions_cents: String(input.deductions_cents),
      request_hi: hi,
      request_lo: lo,
    },
    ZK_ASSETS.wasm,
    ZK_ASSETS.zkey,
  );
  const proveMs = Math.round(performance.now() - t0);
  const vk = await (await fetch(ZK_ASSETS.vkey)).json();
  const offchainValid = await snarkjs.groth16.verify(vk, publicSignals, proof);
  return {
    a: g1(proof.pi_a),
    b: g2(proof.pi_b),
    c: g1(proof.pi_c),
    tax: BigInt(publicSignals[0]),
    net: BigInt(publicSignals[1]),
    publicSignals,
    proofJson: proof,
    offchainValid,
    proveMs,
  };
}

const seed = (s: string) => utf8(s);
export const zkConfigPda = () => PublicKey.findProgramAddressSync([seed("zk_config")], ZK_PROGRAM_ID)[0];
export const zkRecordPda = (request: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("zk"), request.toBytes()], ZK_PROGRAM_ID)[0];

const u64le = (n: bigint | number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};

async function discriminator(ns: "global" | "account", name: string) {
  return (await sha256(`${ns}:${name}`)).slice(0, 8);
}

/** verify_payroll instruction (Anchor discriminator + borsh args). */
export async function verifyPayrollIx(prover: PublicKey, request: PublicKey, input: PayrollInput, proof: ZkProof) {
  const data = cat(
    await discriminator("global", "verify_payroll"),
    proof.a,
    proof.b,
    proof.c,
    u64le(input.salary_cents),
    u64le(input.tax_bps),
    u64le(input.deductions_cents),
    u64le(proof.tax),
    u64le(proof.net),
  );
  return new TransactionInstruction({
    programId: ZK_PROGRAM_ID,
    keys: [
      { pubkey: prover, isSigner: true, isWritable: true },
      { pubkey: zkConfigPda(), isSigner: false, isWritable: true },
      { pubkey: request, isSigner: false, isWritable: false },
      { pubkey: receiptPda(request), isSigner: false, isWritable: false },
      { pubkey: zkRecordPda(request), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export async function buildVerifyTx(connection: Connection, prover: PublicKey, request: PublicKey, input: PayrollInput, proof: ZkProof) {
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
    .add(await verifyPayrollIx(prover, request, input, proof));
  tx.feePayer = prover;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}

/** Decode a ZkProofRecord account (null if absent). */
export async function fetchZkRecord(connection: Connection, request: PublicKey): Promise<ZkRecord | null> {
  const pda = zkRecordPda(request);
  const acc = await connection.getAccountInfo(pda, "confirmed");
  if (!acc || !acc.owner.equals(ZK_PROGRAM_ID)) return null;
  const d = acc.data;
  const disc = await discriminator("account", "ZkProofRecord");
  if (toHex(d.subarray(0, 8)) !== toHex(disc)) return null;
  let o = 8;
  const take = (n: number) => d.subarray(o, (o += n));
  const pk = () => new PublicKey(take(32)).toBase58();
  const hx = () => toHex(take(32));
  const view = (n: number) => {
    const b = take(n);
    return new DataView(b.buffer, b.byteOffset, n);
  };
  const request_ = pk();
  const prover = pk();
  const circuit = new TextDecoder().decode(take(16)).replace(/\0+$/, "");
  const programHash = hx();
  const inputHash = hx();
  const receiptOutputHash = hx();
  const provenOutputHash = hx();
  const matchesReceipt = take(1)[0] === 1;
  const taxCents = view(8).getBigUint64(0, true);
  const netCents = view(8).getBigUint64(0, true);
  const verifiedAt = Number(view(8).getBigInt64(0, true));
  const slot = view(8).getBigUint64(0, true);
  return {
    pda: pda.toBase58(),
    request: request_,
    prover,
    circuit,
    programHash,
    inputHash,
    receiptOutputHash,
    provenOutputHash,
    matchesReceipt,
    taxCents,
    netCents,
    verifiedAt,
    slot,
  };
}
