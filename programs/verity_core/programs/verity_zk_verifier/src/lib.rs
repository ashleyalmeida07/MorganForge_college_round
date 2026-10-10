//! verity_zk_verifier: "proof of execution without re-execution" for the payroll
//! rule set (Implementation_plan.md §4.1 stretch, §5.1 program 2).
//!
//! `verify_payroll` checks a Groth16 proof of zk/payroll/payroll.circom on-chain via
//! the alt_bn128 syscalls and binds it to a verity_core request:
//!   * the request's program_hash must be the registered payroll WASM hash;
//!   * sha256(canonical input JSON rebuilt from the proven integers) == request.input_hash;
//!   * the proof's public inputs include the request PDA (no replay across requests);
//!   * sha256(canonical output JSON rebuilt from the proven outputs) is compared with
//!     the provider receipt's output_hash: equal -> the receipt is zk-verified,
//!     different -> the receipt is *provably wrong* (a zk fraud proof).
//! The result is an immutable ZkProofRecord PDA + ZkVerified event. verity_core is
//! not modified; clients and the backend read the record alongside the request.

use anchor_lang::prelude::*;
use verity_core::state::{Config as CoreConfig, Receipt, Request};

pub mod groth16;
pub mod vk;

declare_id!("A5taiN69gN4EALtyM9X9S7dVMbhA5qo8aejHrfo48mVv");

pub const ZK_CONFIG_SEED: &[u8] = b"zk_config";
pub const ZK_RECORD_SEED: &[u8] = b"zk";
pub const CIRCUIT_PAYROLL_V1: [u8; 16] = *b"payroll_v1\0\0\0\0\0\0";

/// sha256 via the sol_sha256 syscall on-chain.
fn sha256(data: &[u8]) -> [u8; 32] {
    let h = solana_sha256_hasher::hashv(&[data]);
    let mut out = [0u8; 32];
    out.copy_from_slice(h.as_ref());
    out
}

#[program]
pub mod verity_zk_verifier {
    use super::*;

    /// One-time setup by the verity_core config authority.
    pub fn initialize(ctx: Context<Initialize>, payroll_program_hash: [u8; 32]) -> Result<()> {
        require_keys_eq!(ctx.accounts.core_config.authority, ctx.accounts.authority.key(), ZkError::Unauthorized);
        let cfg = &mut ctx.accounts.zk_config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.payroll_program_hash = payroll_program_hash;
        cfg.verified_count = 0;
        cfg.fraud_count = 0;
        cfg.bump = ctx.bumps.zk_config;
        Ok(())
    }

    /// Point the payroll circuit at a rebuilt payroll WASM (new program hash).
    pub fn set_payroll_program_hash(ctx: Context<AdminOnly>, payroll_program_hash: [u8; 32]) -> Result<()> {
        ctx.accounts.zk_config.payroll_program_hash = payroll_program_hash;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn verify_payroll(
        ctx: Context<VerifyPayroll>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        salary_cents: u64,
        tax_bps: u64,
        deductions_cents: u64,
        tax_cents: u64,
        net_cents: u64,
    ) -> Result<()> {
        let request_key = ctx.accounts.request.key();
        let request = &ctx.accounts.request;
        let receipt = &ctx.accounts.receipt;
        let cfg = &mut ctx.accounts.zk_config;

        require!(request.program_hash == cfg.payroll_program_hash, ZkError::WrongProgram);

        let input_json = format!(
            "{{\"deductions_cents\":{},\"salary_cents\":{},\"tax_bps\":{}}}",
            deductions_cents, salary_cents, tax_bps
        );
        require!(sha256(input_json.as_bytes()) == request.input_hash, ZkError::InputMismatch);

        let pda = request_key.to_bytes();
        let hi = u128::from_be_bytes(pda[..16].try_into().unwrap());
        let lo = u128::from_be_bytes(pda[16..].try_into().unwrap());
        let public_inputs = [
            groth16::scalar_u128(tax_cents as u128),
            groth16::scalar_u128(net_cents as u128),
            groth16::scalar_u128(salary_cents as u128),
            groth16::scalar_u128(tax_bps as u128),
            groth16::scalar_u128(deductions_cents as u128),
            groth16::scalar_u128(hi),
            groth16::scalar_u128(lo),
        ];
        groth16::verify(&proof_a, &proof_b, &proof_c, &public_inputs).map_err(|e| {
            msg!("groth16 verification failed: {:?}", e);
            error!(ZkError::InvalidProof)
        })?;

        let output_json = format!(
            "{{\"deductions_cents\":{},\"gross_cents\":{},\"net_cents\":{},\"tax_cents\":{}}}",
            deductions_cents, salary_cents, net_cents, tax_cents
        );
        let proven_output_hash = sha256(output_json.as_bytes());
        let matches_receipt = proven_output_hash == receipt.output_hash;

        let clock = Clock::get()?;
        let rec = &mut ctx.accounts.record;
        rec.request = request_key;
        rec.prover = ctx.accounts.prover.key();
        rec.circuit = CIRCUIT_PAYROLL_V1;
        rec.program_hash = request.program_hash;
        rec.input_hash = request.input_hash;
        rec.receipt_output_hash = receipt.output_hash;
        rec.proven_output_hash = proven_output_hash;
        rec.matches_receipt = matches_receipt;
        rec.tax_cents = tax_cents;
        rec.net_cents = net_cents;
        rec.verified_at = clock.unix_timestamp;
        rec.slot = clock.slot;
        rec.bump = ctx.bumps.record;

        if matches_receipt {
            cfg.verified_count = cfg.verified_count.saturating_add(1);
        } else {
            cfg.fraud_count = cfg.fraud_count.saturating_add(1);
        }
        emit!(ZkVerified {
            request: request_key,
            prover: rec.prover,
            circuit: CIRCUIT_PAYROLL_V1,
            proven_output_hash,
            receipt_output_hash: receipt.output_hash,
            matches_receipt,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = core_config.bump, seeds::program = verity_core::ID)]
    pub core_config: Box<Account<'info, CoreConfig>>,
    #[account(init, payer = authority, space = 8 + ZkConfig::INIT_SPACE, seeds = [ZK_CONFIG_SEED], bump)]
    pub zk_config: Account<'info, ZkConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [ZK_CONFIG_SEED], bump = zk_config.bump, has_one = authority @ ZkError::Unauthorized)]
    pub zk_config: Account<'info, ZkConfig>,
}

#[derive(Accounts)]
pub struct VerifyPayroll<'info> {
    #[account(mut)]
    pub prover: Signer<'info>,
    #[account(mut, seeds = [ZK_CONFIG_SEED], bump = zk_config.bump)]
    pub zk_config: Account<'info, ZkConfig>,
    /// verity_core Request (owner + discriminator checked by Account<>).
    pub request: Box<Account<'info, Request>>,
    #[account(
        seeds = [b"receipt", request.key().as_ref()],
        bump = receipt.bump,
        seeds::program = verity_core::ID,
        constraint = receipt.request == request.key() @ ZkError::ReceiptMismatch,
    )]
    pub receipt: Box<Account<'info, Receipt>>,
    #[account(
        init,
        payer = prover,
        space = 8 + ZkProofRecord::INIT_SPACE,
        seeds = [ZK_RECORD_SEED, request.key().as_ref()],
        bump,
    )]
    pub record: Box<Account<'info, ZkProofRecord>>,
    pub system_program: Program<'info, System>,
}

/// seeds: ["zk_config"]
#[account]
#[derive(InitSpace)]
pub struct ZkConfig {
    pub authority: Pubkey,
    pub payroll_program_hash: [u8; 32],
    pub verified_count: u64,
    pub fraud_count: u64,
    pub bump: u8,
}

/// seeds: ["zk", request]
#[account]
#[derive(InitSpace)]
pub struct ZkProofRecord {
    pub request: Pubkey,
    pub prover: Pubkey,
    pub circuit: [u8; 16],
    pub program_hash: [u8; 32],
    pub input_hash: [u8; 32],
    pub receipt_output_hash: [u8; 32],
    pub proven_output_hash: [u8; 32],
    pub matches_receipt: bool,
    pub tax_cents: u64,
    pub net_cents: u64,
    pub verified_at: i64,
    pub slot: u64,
    pub bump: u8,
}

#[event]
pub struct ZkVerified {
    pub request: Pubkey,
    pub prover: Pubkey,
    pub circuit: [u8; 16],
    pub proven_output_hash: [u8; 32],
    pub receipt_output_hash: [u8; 32],
    pub matches_receipt: bool,
}

#[error_code]
pub enum ZkError {
    #[msg("signer is not the verity_core / zk config authority")]
    Unauthorized,
    #[msg("request is not for the registered payroll program")]
    WrongProgram,
    #[msg("proven input does not hash to the request's input_hash")]
    InputMismatch,
    #[msg("receipt does not belong to this request")]
    ReceiptMismatch,
    #[msg("Groth16 proof verification failed")]
    InvalidProof,
}
