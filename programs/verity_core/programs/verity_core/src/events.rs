use anchor_lang::prelude::*;

#[event]
pub struct Initialized {
    pub authority: Pubkey,
    pub min_provider_stake: u64,
    pub min_dispute_stake: u64,
    pub challenge_window_secs: i64,
    pub required_attestations: u8,
}

#[event]
pub struct ConfigUpdated {
    pub min_provider_stake: u64,
    pub min_dispute_stake: u64,
    pub challenge_window_secs: i64,
    pub required_attestations: u8,
}

#[event]
pub struct VerifierRegistered {
    pub verifier: Pubkey,
}

#[event]
pub struct VerifierStatusChanged {
    pub verifier: Pubkey,
    pub active: bool,
}

#[event]
pub struct ProviderRegistered {
    pub provider: Pubkey,
}

#[event]
pub struct ProviderStaked {
    pub provider: Pubkey,
    pub amount: u64,
    pub total_stake: u64,
}

#[event]
pub struct ProviderUnstaked {
    pub provider: Pubkey,
    pub amount: u64,
    pub total_stake: u64,
}

#[event]
pub struct RequestCreated {
    pub request: Pubkey,
    pub id: u64,
    pub requester: Pubkey,
    pub program_hash: [u8; 32],
    pub input_hash: [u8; 32],
    pub bounty: u64,
    pub deadline: i64,
}

#[event]
pub struct RequestClaimed {
    pub request: Pubkey,
    pub provider: Pubkey,
}

#[event]
pub struct ReceiptSubmitted {
    pub request: Pubkey,
    pub provider: Pubkey,
    pub output_hash: [u8; 32],
    pub trace_root: [u8; 32],
    pub fuel_used: u64,
}

#[event]
pub struct Attested {
    pub request: Pubkey,
    pub verifier: Pubkey,
    pub matches: bool,
    pub counted: bool,
}

#[event]
pub struct DisputeOpened {
    pub request: Pubkey,
    pub challenger: Pubkey,
    pub stake: u64,
    pub claimed_output_hash: [u8; 32],
}

#[event]
pub struct DisputeResolved {
    pub request: Pubkey,
    pub challenger_won: bool,
    pub winner: Pubkey,
    pub slashed: u64,
}

#[event]
pub struct Finalized {
    pub request: Pubkey,
    pub provider: Pubkey,
    pub bounty: u64,
}

#[event]
pub struct Expired {
    pub request: Pubkey,
    pub refunded: u64,
}

#[event]
pub struct AuditRootAnchored {
    pub root: [u8; 32],
    pub index: u64,
    pub timestamp: i64,
}
