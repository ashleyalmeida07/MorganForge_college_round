# Verity

Verifiable computation for a new era of trust. Prove the computation, not just the result.

## Off-Chain Provider Layer

The off-chain provider layer simulates various node operators. Some are honest, and others attempt to cheat by manipulating results, inputs, or traces.

### How to Run the Demo

To test the provider behaviors locally without deploying smart contracts:

1. Navigate to the offchain folder:
   ```bash
   cd offchain
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the CLI tool with the providers you want to simulate (e.g. `honest`, `lazy`, `wrongresult`, `wronginput`, `slow`, `flaky`):
   ```bash
   npx tsx cli.ts honest lazy wrongresult
   ```

You will see output detailing each provider's execution steps, their submitted results, and a table summarizing whether they produced the correct outcome.

### Plugging in the Real Smart Contract

Currently, the system uses an in-memory `MockChain.ts` adapter. Once the Solidity contracts (e.g., `VerityJobs.sol`) are deployed:

1. Create a `ViemChainAdapter.ts` in `offchain/chain/` that implements the `ChainAdapter` interface.
2. Inside this adapter, use `viem` to listen to on-chain `JobCreated` events.
3. Call the `acceptJob` and `submitResult` contract methods using the provider's wallet.
4. Replace `new MockChain()` in `cli.ts` (or your entry point) with `new ViemChainAdapter(rpcUrl, privateKey)`.
5. The providers will seamlessly connect and start interacting with the real blockchain!
