// Initialize (or update) the verity_zk_verifier config. Idempotent.
// PAYROLL_PROGRAM_HASH = hex sha256 of the payroll rule-set WASM (rulesets/payroll).
//
// Usage: DEPLOYER_KEYPAIR=keys/deployer.json PAYROLL_PROGRAM_HASH=<hex> node scripts/setup-zk.mjs
import { setup, pdas, arr } from "./common.mjs";
import { zkProgram, zkPdas } from "./zk-common.mjs";

const hashHex = (process.env.PAYROLL_PROGRAM_HASH || "").toLowerCase();
if (!/^[0-9a-f]{64}$/.test(hashHex)) throw new Error("set PAYROLL_PROGRAM_HASH to a 64-char hex sha256");
const hash = Buffer.from(hashHex, "hex");

const { payer, provider, programId } = setup();
const zk = zkProgram(provider);
const Z = zkPdas(zk.programId);
const existing = await zk.account.zkConfig.fetchNullable(Z.config());

if (!existing) {
  const sig = await zk.methods.initialize(arr(hash))
    .accountsPartial({ authority: payer.publicKey, coreConfig: pdas(programId).config(), zkConfig: Z.config() })
    .rpc();
  console.log("zk config initialized:", sig);
} else if (Buffer.from(existing.payrollProgramHash).toString("hex") !== hashHex) {
  const sig = await zk.methods.setPayrollProgramHash(arr(hash))
    .accountsPartial({ authority: payer.publicKey, zkConfig: Z.config() })
    .rpc();
  console.log("payroll program hash updated:", sig);
} else {
  console.log("zk config already up to date");
}
const cfg = await zk.account.zkConfig.fetch(Z.config());
console.log({
  zkProgram: zk.programId.toBase58(),
  zkConfig: Z.config().toBase58(),
  payrollProgramHash: Buffer.from(cfg.payrollProgramHash).toString("hex"),
  verified: cfg.verifiedCount.toString(),
  fraudProofs: cfg.fraudCount.toString(),
});
