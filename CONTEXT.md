# CONTEXT.md — superseded

This file originally described an EVM/Solidity design (bisection-game dispute resolution,
Foundry/Hardhat, Solidity verifier contracts). The project pivoted to **Solana/Anchor**
(commit `0c94a92`, "Replace EVM contracts with Solana program and rebuild backend") and that
design was never built.

The current, authoritative design is [`Implementation_plan.md`](Implementation_plan.md).
Deployed program state is in [`programs/verity_core/DEPLOYMENT.md`](programs/verity_core/DEPLOYMENT.md).

Dispute resolution today is **attestation-quorum based**, not bisection: verifiers re-execute
the whole job and attest match/mismatch on-chain; a mismatch quorum opens a dispute that slashes
the provider. See Implementation_plan.md §5.4 (`attest`, `open_dispute`, `resolve_dispute`) and
`programs/verity_core/DEPLOYMENT.md` for how `resolve_dispute` actually works on devnet.
