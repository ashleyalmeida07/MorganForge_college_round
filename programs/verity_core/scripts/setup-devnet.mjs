// Idempotent post-deploy setup on devnet:
//  - initialize Config (if missing)
//  - create + fund provider and 3 verifier keypairs (keys/*.json, gitignored)
//  - register the verifiers, register + stake the provider
//
// Usage: DEPLOYER_KEYPAIR=/path/deployer.json node scripts/setup-devnet.mjs
import {
  setup, pdas, namedKeypair, fundIfLow, exists, BN, LAMPORTS_PER_SOL, sol,
} from "./common.mjs";

const PARAMS = {
  minProviderStake: new BN(0.2 * LAMPORTS_PER_SOL),
  minDisputeStake: new BN(0.05 * LAMPORTS_PER_SOL),
  challengeWindowSecs: new BN(120),
  requiredAttestations: 2,
};

const { payer, connection, program, programId } = setup();
const P = pdas(programId);
console.log("program  :", programId.toBase58());
console.log("authority:", payer.publicKey.toBase58(), sol(await connection.getBalance(payer.publicKey)), "SOL");

const configPda = P.config();
if (!(await exists(connection, configPda))) {
  const sig = await program.methods
    .initialize(PARAMS)
    .accountsPartial({ config: configPda, authority: payer.publicKey })
    .rpc();
  console.log("initialize:", sig);
} else {
  console.log("config exists:", configPda.toBase58());
}

const provider = namedKeypair("provider");
const verifiers = [1, 2, 3].map((i) => namedKeypair(`verifier${i}`));

await fundIfLow(connection, payer, provider.publicKey, 0.5, 1.0);
for (const v of verifiers) await fundIfLow(connection, payer, v.publicKey, 0.1, 0.25);

for (const v of verifiers) {
  const rec = P.verifier(v.publicKey);
  if (!(await exists(connection, rec))) {
    const sig = await program.methods
      .registerVerifier(v.publicKey)
      .accountsPartial({ config: configPda, verifierRecord: rec, authority: payer.publicKey })
      .rpc();
    console.log("register_verifier", v.publicKey.toBase58(), sig);
  }
}

const providerPda = P.provider(provider.publicKey);
if (!(await exists(connection, providerPda))) {
  const sig = await program.methods
    .registerProvider()
    .accountsPartial({ provider: providerPda, owner: provider.publicKey })
    .signers([provider])
    .rpc();
  console.log("register_provider:", sig);
}
const cfg = await program.account.config.fetch(configPda);
const prov = await program.account.provider.fetch(providerPda);
if (prov.stake.lt(cfg.minProviderStake)) {
  const amount = cfg.minProviderStake.sub(prov.stake);
  const sig = await program.methods
    .stakeProvider(amount)
    .accountsPartial({ provider: providerPda, owner: provider.publicKey })
    .signers([provider])
    .rpc();
  console.log("stake_provider", sol(amount), "SOL:", sig);
}

const finalCfg = await program.account.config.fetch(configPda);
const finalProv = await program.account.provider.fetch(providerPda);
console.log("\nconfig:", {
  authority: finalCfg.authority.toBase58(),
  minProviderStake: sol(finalCfg.minProviderStake),
  minDisputeStake: sol(finalCfg.minDisputeStake),
  challengeWindowSecs: finalCfg.challengeWindowSecs.toString(),
  requiredAttestations: finalCfg.requiredAttestations,
  requestCount: finalCfg.requestCount.toString(),
  verifierCount: finalCfg.verifierCount,
});
console.log("provider:", provider.publicKey.toBase58(), "stake", sol(finalProv.stake));
verifiers.forEach((v, i) => console.log(`verifier${i + 1}:`, v.publicKey.toBase58()));
