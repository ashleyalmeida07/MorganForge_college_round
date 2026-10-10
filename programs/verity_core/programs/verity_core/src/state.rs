use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const PROVIDER_SEED: &[u8] = b"provider";
pub const VERIFIER_SEED: &[u8] = b"verifier";
pub const REQUEST_SEED: &[u8] = b"request";
pub const RECEIPT_SEED: &[u8] = b"receipt";
pub const ATTESTATION_SEED: &[u8] = b"attestation";
pub const DISPUTE_SEED: &[u8] = b"dispute";

/// Domain separator for the canonical receipt message the provider signs.
pub const RECEIPT_DOMAIN: &[u8] = b"VERITY_RECEIPT_V1";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum RequestStatus {
    Open,
    Claimed,
    AwaitingVerification,
    Disputed,
    Verified,
    Rejected,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum DisputeStatus {
    Open,
    ChallengerWon,
    ProviderWon,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ConfigParams {
    pub min_provider_stake: u64,
    pub min_dispute_stake: u64,
    pub challenge_window_secs: i64,
    pub required_attestations: u8,
}

/// seeds: ["config"]
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub min_provider_stake: u64,
    pub min_dispute_stake: u64,
    pub challenge_window_secs: i64,
    pub required_attestations: u8,
    pub request_count: u64,
    pub verifier_count: u32,
    pub latest_audit_root: [u8; 32],
    pub audit_root_count: u64,
    pub bump: u8,
}

/// seeds: ["provider", owner]
#[account]
#[derive(InitSpace)]
pub struct Provider {
    pub owner: Pubkey,
    pub stake: u64,
    pub completed: u32,
    pub slashed: u32,
    pub active_jobs: u32,
    pub active: bool,
    pub bump: u8,
}

/// seeds: ["verifier", verifier]. Only attestations from active registered
/// verifiers count toward the quorum (Sybil resistance).
#[account]
#[derive(InitSpace)]
pub struct VerifierRecord {
    pub verifier: Pubkey,
    pub active: bool,
    pub attestations: u32,
    pub bump: u8,
}

/// seeds: ["request", requester, id (u64 LE)] where id = config.request_count at creation.
#[account]
#[derive(InitSpace)]
pub struct Request {
    pub id: u64,
    pub requester: Pubkey,
    pub program_hash: [u8; 32],
    pub input_hash: [u8; 32],
    pub input_uri_hash: [u8; 32],
    pub bounty: u64,
    pub deadline: i64,
    pub status: RequestStatus,
    /// Pubkey::default() until claimed.
    pub provider: Pubkey,
    pub created_at: i64,
    pub receipt_at: i64,
    pub attest_count_match: u8,
    pub attest_count_mismatch: u8,
    pub attest_count_total: u8,
    /// true once the bounty has left the escrow (paid, refunded).
    pub settled: bool,
    pub bump: u8,
}

/// seeds: ["receipt", request]
#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub request: Pubkey,
    pub provider: Pubkey,
    pub output_hash: [u8; 32],
    pub trace_root: [u8; 32],
    pub fuel_used: u64,
    pub signature: [u8; 64],
    pub submitted_at: i64,
    pub bump: u8,
}

/// seeds: ["attestation", request, verifier]
#[account]
#[derive(InitSpace)]
pub struct Attestation {
    pub request: Pubkey,
    pub verifier: Pubkey,
    pub output_hash: [u8; 32],
    pub trace_root: [u8; 32],
    pub fuel_used: u64,
    pub matches: bool,
    /// true if the verifier was an active registered verifier (counts toward quorum).
    pub counted: bool,
    pub attested_at: i64,
    pub bump: u8,
}

/// seeds: ["dispute", request]
#[account]
#[derive(InitSpace)]
pub struct Dispute {
    pub request: Pubkey,
    pub challenger: Pubkey,
    pub stake: u64,
    pub claimed_output_hash: [u8; 32],
    pub status: DisputeStatus,
    pub opened_at: i64,
    pub resolved_at: i64,
    pub bump: u8,
}
