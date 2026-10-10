use anchor_lang::prelude::*;

#[error_code]
pub enum VerityError {
    #[msg("Invalid configuration parameters")]
    InvalidParams,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Request is not in the required status for this action")]
    InvalidStatus,
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Request deadline has passed")]
    DeadlinePassed,
    #[msg("Request deadline has not passed yet")]
    DeadlineNotReached,
    #[msg("Bounty must be greater than zero")]
    ZeroBounty,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Provider stake is below the minimum")]
    InsufficientStake,
    #[msg("Provider is not active")]
    ProviderInactive,
    #[msg("Provider has active jobs and cannot unstake")]
    ProviderHasActiveJobs,
    #[msg("Signer is not the provider assigned to this request")]
    NotAssignedProvider,
    #[msg("Account does not match the request")]
    AccountMismatch,
    #[msg("Missing or malformed Ed25519 signature-verification instruction")]
    InvalidSignatureInstruction,
    #[msg("Ed25519 instruction does not match provider key, signature or receipt message")]
    SignatureMismatch,
    #[msg("The provider cannot attest to its own receipt")]
    ProviderCannotAttest,
    #[msg("The provider cannot dispute its own receipt")]
    ProviderCannotDispute,
    #[msg("Claimed output hash equals the receipt output hash")]
    ClaimMatchesReceipt,
    #[msg("Challenge window has not elapsed")]
    ChallengeWindowOpen,
    #[msg("Not enough matching attestations to finalize")]
    QuorumNotReached,
    #[msg("Invalid evidence accounts supplied to resolve_dispute")]
    InvalidEvidence,
    #[msg("Duplicate verifier in evidence")]
    DuplicateVerifier,
    #[msg("Provider account required for a claimed request")]
    ProviderAccountRequired,
}
