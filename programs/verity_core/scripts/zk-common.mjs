// Helpers for the verity_zk_verifier program: IDL client, PDAs, proving with snarkjs.
import fs from "node:fs";
import path from "node:path";
import anchor from "@coral-xyz/anchor";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import * as snarkjs from "snarkjs";

import { ROOT, enc, sha256 } from "./common.mjs";

const { Program } = anchor;
export const ZK_DIR = path.join(ROOT, "zk-artifacts");

export function zkProgram(provider) {
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/verity_zk_verifier.json"), "utf8"));
  return new Program(idl, provider);
}

export function zkPdas(programId) {
  const f = (seeds) => PublicKey.findProgramAddressSync(seeds, programId)[0];
  return { config: () => f([enc("zk_config")]), record: (request) => f([enc("zk"), request.toBuffer()]) };
}

export const payrollInputJson = (i) =>
  `{"deductions_cents":${i.deductions_cents},"salary_cents":${i.salary_cents},"tax_bps":${i.tax_bps}}`;
export const payrollOutputJson = (i, tax, net) =>
  `{"deductions_cents":${i.deductions_cents},"gross_cents":${i.salary_cents},"net_cents":${net},"tax_cents":${tax}}`;

const be32 = (v) => {
  let n = BigInt(v);
  const out = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
};
const g1 = (p) => Buffer.concat([be32(p[0]), be32(p[1])]);
const g2 = (p) => Buffer.concat([be32(p[0][1]), be32(p[0][0]), be32(p[1][1]), be32(p[1][0])]);

/** Prove the payroll circuit for `input`, bound to `requestPda`. */
export async function provePayroll(input, requestPda) {
  const b = requestPda.toBuffer();
  const hi = BigInt("0x" + b.subarray(0, 16).toString("hex")).toString();
  const lo = BigInt("0x" + b.subarray(16).toString("hex")).toString();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { ...input, request_hi: hi, request_lo: lo },
    path.join(ZK_DIR, "payroll.wasm"),
    path.join(ZK_DIR, "payroll_final.zkey"),
  );
  return {
    a: [...g1(proof.pi_a)],
    b: [...g2(proof.pi_b)],
    c: [...g1(proof.pi_c)],
    tax: BigInt(publicSignals[0]),
    net: BigInt(publicSignals[1]),
    publicSignals,
  };
}

export const computeBudget = () => ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
export { sha256 };
