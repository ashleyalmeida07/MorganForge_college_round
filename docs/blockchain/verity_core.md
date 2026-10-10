# `verity_core` — Core Program

Program ID `ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1` · Anchor 0.32.1 · source `programs/verity_core/programs/verity_core/src/`

`verity_core` is the single source of truth for verifiable-computation requests. It escrows bounties, stakes providers, records signed execution receipts and verifier attestations, resolves staked disputes with slashing, and anchors the off-chain audit log. One program holds every account type; modularity comes from account types, not from multiple programs.

## Request lifecycle

```
                 claim_request              submit_receipt (+Ed25519 ix)
   ┌──────┐   (provider, staked)   ┌─────────┐  (assigned provider)  ┌──────────────────────┐
   │ Open │ ─────────────────────► │ Claimed │ ────────────────────► │ AwaitingVerification │◄─┐
   └──┬───┘                        └────┬────┘                       └──────┬───────┬───────┘  │
      │ expire_request                  │ expire_request         finalize   │       │ open_dispute
      │ (after deadline)                │ (after deadline)  (window over +  │       │ (stake, claim ≠ receipt)
      ▼                                 ▼                   quorum matches) ▼       ▼          │
   ┌─────────┐                     ┌─────────┐                     ┌──────────┐ ┌──────────┐   │
   │ Expired │                     │ Expired │                     │ Verified │ │ Disputed │───┘ resolve_dispute:
   └─────────┘                     └─────────┘                     └──────────┘ └────┬─────┘     provider wins
                                                                                      │ resolve_dispute:
                                                                                      ▼ challenger wins
                                                                               ┌──────────┐  expire_request
                                                                               │ Rejected │ ──► bounty refunded
                                                                               └──────────┘
```

| Instruction | Who | Requires | Effect |
|---|---|---|---|
| `create_request` | requester wallet | `bounty > 0`, `deadline > now` | Creates `Request` PDA `["request", requester, config.request_count]`, moves bounty into it, status `Open`, increments `request_count` |
| `claim_request` | provider | provider `active` and `stake ≥ min_provider_stake`; `Open`; `now ≤ deadline` | `Claimed`, sets `provider`, `active_jobs += 1` |
| `submit_receipt` | assigned provider | `Claimed`; `now ≤ deadline`; preceding Ed25519 instruction verifies the receipt signature | Creates `Receipt` PDA; status `AwaitingVerification`; `receipt_at = now` |
| `attest` | anyone (counts only for active registered verifiers) | `AwaitingVerification` or `Disputed`; verifier ≠ provider | Creates `Attestation` PDA; `matches = output_hash ∧ trace_root ∧ fuel_used all equal the receipt`; bumps match/mismatch counters if counted |
| `open_dispute` | anyone except the provider | `AwaitingVerification`; `claimed_output_hash ≠ receipt.output_hash` | Escrows `min_dispute_stake` in the `Dispute` PDA; status `Disputed` |
| `resolve_dispute` | anyone | `Disputed` and dispute `Open`; evidence in `remaining_accounts` | **Challenger wins** if ≥ quorum counted mismatch attestations claim the same hash: slash, stake returned, `Rejected`. **Otherwise**, after the window, the provider receives the challenger's stake and the status returns to `AwaitingVerification` |
| `finalize` | anyone | `AwaitingVerification`; `now ≥ receipt_at + challenge_window_secs`; `attest_count_match ≥ quorum` | `Verified`; bounty paid to the provider; `completed += 1` |
| `expire_request` | anyone | not settled; `Open`/`Claimed` past the deadline, **or** `Rejected` | Refunds the bounty to the requester; `Expired` (or stays `Rejected`); settled |

## Economics

- **Bounty**: lamports escrowed inside the `Request` PDA. Paid to the provider on `finalize`, or refunded to the requester by `expire_request`.
- **Provider stake**: `stake_provider` moves lamports into the `Provider` PDA. A provider can only claim with `stake ≥ min_provider_stake` and can only `unstake_provider` with `active_jobs == 0`.
- **Slashing** (challenger wins): `slashed = min(stake, min_provider_stake)`. Half is split equally among the supporting verifiers; the rest, including the remainder, goes to the challenger. The challenger's dispute stake is returned. `Provider.slashed += 1`.
- **Frivolous dispute** (provider wins): the challenger's stake is paid to the provider owner.
- **Known limitation**: a request stuck in `AwaitingVerification` (quorum never reached and no dispute) cannot be finalized or expired, so its bounty stays escrowed. `expire_request` only accepts `Open`, `Claimed` (after the deadline) and `Rejected`.

## Ed25519 receipt check

`submit_receipt` takes `(output_hash, trace_root, fuel_used, signature)`. The transaction must contain an **Ed25519 precompile instruction** (`Ed25519SigVerify111111111111111111111111111`) immediately before it. The program loads it through the instructions sysvar (`ed25519.rs`) and requires that:

- the instruction has exactly 1 signature, with all offsets pointing inside its own data;
- its public key equals the assigned provider;
- its message equals the canonical receipt bytes (see [protocol-formats.md](protocol-formats.md#receipt-message));
- its signature equals the `signature` argument.

The precompile checks the signature itself; a mismatch fails with `SignatureMismatch`. Because the message embeds the request PDA, a receipt can never be replayed onto another request.

## Sybil resistance

Anyone may `attest`, and the attestation is stored with `counted = false`. Only attestations whose signer has an active `VerifierRecord` (created by the admin via `register_verifier`) are `counted` and contribute to quorum, `finalize` and `resolve_dispute` evidence.

## `resolve_dispute` evidence

`remaining_accounts` = pairs of `(Attestation PDA, verifier wallet [writable])`. Each attestation must:
- be owned by `verity_core` and belong to this request;
- have `counted && !matches`;
- have `output_hash == dispute.claimed_output_hash`;
- have its wallet equal `att.verifier`.

Duplicate verifiers are rejected.

## Admin instructions

`initialize`, `update_config`, `transfer_authority`, `register_verifier`, `set_verifier_active` and `anchor_audit_root` all require the signer to be `Config.authority`. `anchor_audit_root` writes the backend's hash-chained `audit_log` head into `Config.latest_audit_root` and increments `audit_root_count`: tamper evidence for the off-chain database.

---

# Reference (generated from `idl/verity_core.json`)

## Instructions (17)

### `anchor_audit_root`

Discriminator: `3035c0f02666a940`

| Arg | Type |
|---|---|
| `root` | `[u8; 32]` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `config` |  | yes | ["config"] |
| 1 | `authority` | yes |  |  |

### `attest`

Anyone may attest; only active registered verifiers count toward quorum.

Discriminator: `53947877908b75a0`

| Arg | Type |
|---|---|
| `output_hash` | `[u8; 32]` |
| `trace_root` | `[u8; 32]` |
| `fuel_used` | `u64` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `request` |  | yes |  |
| 1 | `receipt` |  |  | ["receipt", request] |
| 2 | `attestation` |  | yes | ["attestation", request, verifier] |
| 3 | `verifier_record` (optional) |  | yes | ["verifier", verifier] |
| 4 | `verifier` | yes | yes |  |
| 5 | `system_program` |  |  | `11111111111111111111111111111111` |

### `claim_request`

Discriminator: `5312269582487bdd`

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `config` |  |  | ["config"] |
| 1 | `request` |  | yes |  |
| 2 | `provider` |  | yes | ["provider", provider_owner] |
| 3 | `provider_owner` | yes |  |  |

### `create_request`

Discriminator: `dbbf5ded122c2a54`

| Arg | Type |
|---|---|
| `program_hash` | `[u8; 32]` |
| `input_hash` | `[u8; 32]` |
| `input_uri_hash` | `[u8; 32]` |
| `bounty` | `u64` |
| `deadline` | `i64` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `config` |  | yes | ["config"] |
| 1 | `request` |  | yes | ["request", requester, config.request_count] |
| 2 | `requester` | yes | yes |  |
| 3 | `system_program` |  |  | `11111111111111111111111111111111` |

### `expire_request`

Refunds the bounty to the requester when (a) an Open/Claimed request passed its deadline without a receipt, or (b) the request was Rejected through a dispute. Permissionless.

Discriminator: `dbbd6961e32f7c17`

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `request` |  | yes |  |
| 1 | `requester` |  | yes |  |
| 2 | `provider` (optional) |  | yes | ["provider", request.provider] |

### `finalize`

Discriminator: `ab3dda387f730cd9`

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `config` |  |  | ["config"] |
| 1 | `request` |  | yes |  |
| 2 | `provider` |  | yes | ["provider", request.provider] |
| 3 | `provider_owner` |  | yes |  |

### `initialize`

Discriminator: `afaf6d1f0d989bed`

| Arg | Type |
|---|---|
| `params` | `ConfigParams` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `config` |  | yes | ["config"] |
| 1 | `authority` | yes | yes |  |
| 2 | `system_program` |  |  | `11111111111111111111111111111111` |

### `open_dispute`

Discriminator: `8919637717dfa12a`

| Arg | Type |
|---|---|
| `claimed_output_hash` | `[u8; 32]` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `config` |  |  | ["config"] |
| 1 | `request` |  | yes |  |
| 2 | `receipt` |  |  | ["receipt", request] |
| 3 | `dispute` |  | yes | ["dispute", request] |
| 4 | `challenger` | yes | yes |  |
| 5 | `system_program` |  |  | `11111111111111111111111111111111` |

### `register_provider`

Discriminator: `fed136b82ec56d4e`

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `provider` |  | yes | ["provider", owner] |
| 1 | `owner` | yes | yes |  |
| 2 | `system_program` |  |  | `11111111111111111111111111111111` |

### `register_verifier`

Discriminator: `43eaaca9b8bc919c`

| Arg | Type |
|---|---|
| `verifier` | `pubkey` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `config` |  | yes | ["config"] |
| 1 | `verifier_record` |  | yes | ["verifier", arg:verifier] |
| 2 | `authority` | yes | yes |  |
| 3 | `system_program` |  |  | `11111111111111111111111111111111` |

### `resolve_dispute`

Permissionless. `remaining_accounts` = pairs of (attestation PDA, verifier wallet [writable]) supporting the challenger. Challenger wins if >= quorum counted mismatch attestations agree with the claimed output hash: provider is slashed (half to challenger, half split among supporting verifiers), challenger stake returned, request Rejected (bounty refundable via `expire_request`). Otherwise, once the challenge window since the dispute opened has elapsed, the provider wins and receives the challenger's stake.

Discriminator: `e706ca0660670ce6`

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `config` |  |  | ["config"] |
| 1 | `request` |  | yes |  |
| 2 | `dispute` |  | yes | ["dispute", request] |
| 3 | `provider` |  | yes | ["provider", request.provider] |
| 4 | `provider_owner` |  | yes |  |
| 5 | `challenger` |  | yes |  |

### `set_verifier_active`

Discriminator: `6ea08e8957a28d7c`

| Arg | Type |
|---|---|
| `active` | `bool` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `config` |  |  | ["config"] |
| 1 | `verifier_record` |  | yes | ["verifier", verifier_record.verifier] |
| 2 | `authority` | yes |  |  |

### `stake_provider`

Discriminator: `12c76d4e0ee00577`

| Arg | Type |
|---|---|
| `amount` | `u64` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `provider` |  | yes | ["provider", owner] |
| 1 | `owner` | yes | yes |  |
| 2 | `system_program` |  |  | `11111111111111111111111111111111` |

### `submit_receipt`

Must be preceded (immediately) by an Ed25519Program instruction that verifies `signature` by the provider over the canonical receipt bytes.

Discriminator: `ac547723c39ad6b0`

| Arg | Type |
|---|---|
| `output_hash` | `[u8; 32]` |
| `trace_root` | `[u8; 32]` |
| `fuel_used` | `u64` |
| `signature` | `[u8; 64]` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `request` |  | yes |  |
| 1 | `receipt` |  | yes | ["receipt", request] |
| 2 | `provider_owner` | yes | yes |  |
| 3 | `instructions` |  |  | `Sysvar1nstructions1111111111111111111111111` |
| 4 | `system_program` |  |  | `11111111111111111111111111111111` |

### `transfer_authority`

Discriminator: `30a94c48e5b437a1`

| Arg | Type |
|---|---|
| `new_authority` | `pubkey` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `config` |  | yes | ["config"] |
| 1 | `authority` | yes |  |  |

### `unstake_provider`

Discriminator: `0371e63352f7a026`

| Arg | Type |
|---|---|
| `amount` | `u64` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `provider` |  | yes | ["provider", owner] |
| 1 | `owner` | yes | yes |  |

### `update_config`

Discriminator: `1d9efcbf0a53db63`

| Arg | Type |
|---|---|
| `params` | `ConfigParams` |

| # | Account | Signer | Writable | PDA seeds / fixed address |
|---|---|---|---|---|
| 0 | `config` |  | yes | ["config"] |
| 1 | `authority` | yes |  |  |

## Accounts (7)

### `Attestation`

Discriminator: `987db75624927949`

| Field | Type |
|---|---|
| `request` | `pubkey` |
| `verifier` | `pubkey` |
| `output_hash` | `[u8; 32]` |
| `trace_root` | `[u8; 32]` |
| `fuel_used` | `u64` |
| `matches` | `bool` |
| `counted` | `bool` |
| `attested_at` | `i64` |
| `bump` | `u8` |

### `Config`

Discriminator: `9b0caae01efacc82`

| Field | Type |
|---|---|
| `authority` | `pubkey` |
| `min_provider_stake` | `u64` |
| `min_dispute_stake` | `u64` |
| `challenge_window_secs` | `i64` |
| `required_attestations` | `u8` |
| `request_count` | `u64` |
| `verifier_count` | `u32` |
| `latest_audit_root` | `[u8; 32]` |
| `audit_root_count` | `u64` |
| `bump` | `u8` |

### `Dispute`

Discriminator: `2431f1432824f14a`

| Field | Type |
|---|---|
| `request` | `pubkey` |
| `challenger` | `pubkey` |
| `stake` | `u64` |
| `claimed_output_hash` | `[u8; 32]` |
| `status` | `DisputeStatus` |
| `opened_at` | `i64` |
| `resolved_at` | `i64` |
| `bump` | `u8` |

### `Provider`

Discriminator: `a4b447114bd850c3`

| Field | Type |
|---|---|
| `owner` | `pubkey` |
| `stake` | `u64` |
| `completed` | `u32` |
| `slashed` | `u32` |
| `active_jobs` | `u32` |
| `active` | `bool` |
| `bump` | `u8` |

### `Receipt`

Discriminator: `279a496a50669199`

| Field | Type |
|---|---|
| `request` | `pubkey` |
| `provider` | `pubkey` |
| `output_hash` | `[u8; 32]` |
| `trace_root` | `[u8; 32]` |
| `fuel_used` | `u64` |
| `signature` | `[u8; 64]` |
| `submitted_at` | `i64` |
| `bump` | `u8` |

### `Request`

Discriminator: `7dac96a1a2732747`

| Field | Type |
|---|---|
| `id` | `u64` |
| `requester` | `pubkey` |
| `program_hash` | `[u8; 32]` |
| `input_hash` | `[u8; 32]` |
| `input_uri_hash` | `[u8; 32]` |
| `bounty` | `u64` |
| `deadline` | `i64` |
| `status` | `RequestStatus` |
| `provider` | `pubkey` |
| `created_at` | `i64` |
| `receipt_at` | `i64` |
| `attest_count_match` | `u8` |
| `attest_count_mismatch` | `u8` |
| `attest_count_total` | `u8` |
| `settled` | `bool` |
| `bump` | `u8` |

### `VerifierRecord`

Discriminator: `7a893d34fe5089e5`

| Field | Type |
|---|---|
| `verifier` | `pubkey` |
| `active` | `bool` |
| `attestations` | `u32` |
| `bump` | `u8` |

## Events (16)

| Event | Fields |
|---|---|
| `Attested` | `request: pubkey`, `verifier: pubkey`, `matches: bool`, `counted: bool` |
| `AuditRootAnchored` | `root: [u8; 32]`, `index: u64`, `timestamp: i64` |
| `ConfigUpdated` | `min_provider_stake: u64`, `min_dispute_stake: u64`, `challenge_window_secs: i64`, `required_attestations: u8` |
| `DisputeOpened` | `request: pubkey`, `challenger: pubkey`, `stake: u64`, `claimed_output_hash: [u8; 32]` |
| `DisputeResolved` | `request: pubkey`, `challenger_won: bool`, `winner: pubkey`, `slashed: u64` |
| `Expired` | `request: pubkey`, `refunded: u64` |
| `Finalized` | `request: pubkey`, `provider: pubkey`, `bounty: u64` |
| `Initialized` | `authority: pubkey`, `min_provider_stake: u64`, `min_dispute_stake: u64`, `challenge_window_secs: i64`, `required_attestations: u8` |
| `ProviderRegistered` | `provider: pubkey` |
| `ProviderStaked` | `provider: pubkey`, `amount: u64`, `total_stake: u64` |
| `ProviderUnstaked` | `provider: pubkey`, `amount: u64`, `total_stake: u64` |
| `ReceiptSubmitted` | `request: pubkey`, `provider: pubkey`, `output_hash: [u8; 32]`, `trace_root: [u8; 32]`, `fuel_used: u64` |
| `RequestClaimed` | `request: pubkey`, `provider: pubkey` |
| `RequestCreated` | `request: pubkey`, `id: u64`, `requester: pubkey`, `program_hash: [u8; 32]`, `input_hash: [u8; 32]`, `bounty: u64`, `deadline: i64` |
| `VerifierRegistered` | `verifier: pubkey` |
| `VerifierStatusChanged` | `verifier: pubkey`, `active: bool` |

## Enums

- `DisputeStatus`: 0 = `Open` · 1 = `ChallengerWon` · 2 = `ProviderWon`
- `RequestStatus`: 0 = `Open` · 1 = `Claimed` · 2 = `AwaitingVerification` · 3 = `Disputed` · 4 = `Verified` · 5 = `Rejected` · 6 = `Expired`

### Type `ConfigParams`

| Field | Type |
|---|---|
| `min_provider_stake` | `u64` |
| `min_dispute_stake` | `u64` |
| `challenge_window_secs` | `i64` |
| `required_attestations` | `u8` |

## Errors (23)

| Code | Hex | Name | Message |
|---|---|---|---|
| 6000 | `0x1770` | `InvalidParams` | Invalid configuration parameters |
| 6001 | `0x1771` | `MathOverflow` | Arithmetic overflow |
| 6002 | `0x1772` | `InvalidStatus` | Request is not in the required status for this action |
| 6003 | `0x1773` | `DeadlineInPast` | Deadline must be in the future |
| 6004 | `0x1774` | `DeadlinePassed` | Request deadline has passed |
| 6005 | `0x1775` | `DeadlineNotReached` | Request deadline has not passed yet |
| 6006 | `0x1776` | `ZeroBounty` | Bounty must be greater than zero |
| 6007 | `0x1777` | `ZeroAmount` | Amount must be greater than zero |
| 6008 | `0x1778` | `InsufficientStake` | Provider stake is below the minimum |
| 6009 | `0x1779` | `ProviderInactive` | Provider is not active |
| 6010 | `0x177a` | `ProviderHasActiveJobs` | Provider has active jobs and cannot unstake |
| 6011 | `0x177b` | `NotAssignedProvider` | Signer is not the provider assigned to this request |
| 6012 | `0x177c` | `AccountMismatch` | Account does not match the request |
| 6013 | `0x177d` | `InvalidSignatureInstruction` | Missing or malformed Ed25519 signature-verification instruction |
| 6014 | `0x177e` | `SignatureMismatch` | Ed25519 instruction does not match provider key, signature or receipt message |
| 6015 | `0x177f` | `ProviderCannotAttest` | The provider cannot attest to its own receipt |
| 6016 | `0x1780` | `ProviderCannotDispute` | The provider cannot dispute its own receipt |
| 6017 | `0x1781` | `ClaimMatchesReceipt` | Claimed output hash equals the receipt output hash |
| 6018 | `0x1782` | `ChallengeWindowOpen` | Challenge window has not elapsed |
| 6019 | `0x1783` | `QuorumNotReached` | Not enough matching attestations to finalize |
| 6020 | `0x1784` | `InvalidEvidence` | Invalid evidence accounts supplied to resolve_dispute |
| 6021 | `0x1785` | `DuplicateVerifier` | Duplicate verifier in evidence |
| 6022 | `0x1786` | `ProviderAccountRequired` | Provider account required for a claimed request |
