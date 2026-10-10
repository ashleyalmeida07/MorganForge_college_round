//! Verity core program: verifiable-computation requests, signed execution
//! receipts, verifier attestations, disputes with stake slashing, and
//! audit-root anchoring.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as ix_sysvar;
use anchor_lang::system_program;

pub mod ed25519;
pub mod errors;
pub mod events;
pub mod state;

use errors::VerityError;
use events::*;
use state::*;

declare_id!("ByADChPce9hwCuSak9hFwiiCyndYGj7dkYypm4XYEJL1");

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

/// Move lamports out of a program-owned account into any account.
fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let from_bal = from.lamports();
    **from.try_borrow_mut_lamports()? = from_bal
        .checked_sub(amount)
        .ok_or(VerityError::MathOverflow)?;
    let to_bal = to.lamports();
    **to.try_borrow_mut_lamports()? = to_bal
        .checked_add(amount)
        .ok_or(VerityError::MathOverflow)?;
    Ok(())
}

fn validate_params(p: &ConfigParams) -> Result<()> {
    require!(p.required_attestations >= 1, VerityError::InvalidParams);
    require!(p.challenge_window_secs >= 0, VerityError::InvalidParams);
    Ok(())
}

/// Canonical receipt bytes:
/// "VERITY_RECEIPT_V1" || request(32) || program_hash(32) || input_hash(32)
/// || output_hash(32) || trace_root(32) || fuel_used(u64 LE)
pub fn receipt_message(
    request: &Pubkey,
    program_hash: &[u8; 32],
    input_hash: &[u8; 32],
    output_hash: &[u8; 32],
    trace_root: &[u8; 32],
    fuel_used: u64,
) -> Vec<u8> {
    let mut m = Vec::with_capacity(RECEIPT_DOMAIN.len() + 32 * 5 + 8);
    m.extend_from_slice(RECEIPT_DOMAIN);
    m.extend_from_slice(request.as_ref());
    m.extend_from_slice(program_hash);
    m.extend_from_slice(input_hash);
    m.extend_from_slice(output_hash);
    m.extend_from_slice(trace_root);
    m.extend_from_slice(&fuel_used.to_le_bytes());
    m
}

#[program]
pub mod verity_core {
    use super::*;

    // ------------------------------------------------------------------ admin

    pub fn initialize(ctx: Context<Initialize>, params: ConfigParams) -> Result<()> {
        validate_params(&params)?;
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.min_provider_stake = params.min_provider_stake;
        c.min_dispute_stake = params.min_dispute_stake;
        c.challenge_window_secs = params.challenge_window_secs;
        c.required_attestations = params.required_attestations;
        c.request_count = 0;
        c.verifier_count = 0;
        c.latest_audit_root = [0u8; 32];
        c.audit_root_count = 0;
        c.bump = ctx.bumps.config;
        emit!(Initialized {
            authority: c.authority,
            min_provider_stake: c.min_provider_stake,
            min_dispute_stake: c.min_dispute_stake,
            challenge_window_secs: c.challenge_window_secs,
            required_attestations: c.required_attestations,
        });
        Ok(())
    }

    pub fn update_config(ctx: Context<AdminOnly>, params: ConfigParams) -> Result<()> {
        validate_params(&params)?;
        let c = &mut ctx.accounts.config;
        c.min_provider_stake = params.min_provider_stake;
        c.min_dispute_stake = params.min_dispute_stake;
        c.challenge_window_secs = params.challenge_window_secs;
        c.required_attestations = params.required_attestations;
        emit!(ConfigUpdated {
            min_provider_stake: c.min_provider_stake,
            min_dispute_stake: c.min_dispute_stake,
            challenge_window_secs: c.challenge_window_secs,
            required_attestations: c.required_attestations,
        });
        Ok(())
    }

    pub fn transfer_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.config.authority = new_authority;
        Ok(())
    }

    pub fn register_verifier(ctx: Context<RegisterVerifier>, verifier: Pubkey) -> Result<()> {
        let v = &mut ctx.accounts.verifier_record;
        v.verifier = verifier;
        v.active = true;
        v.attestations = 0;
        v.bump = ctx.bumps.verifier_record;
        let c = &mut ctx.accounts.config;
        c.verifier_count = c.verifier_count.saturating_add(1);
        emit!(VerifierRegistered { verifier });
        Ok(())
    }

    pub fn set_verifier_active(ctx: Context<SetVerifierActive>, active: bool) -> Result<()> {
        let v = &mut ctx.accounts.verifier_record;
        v.active = active;
        emit!(VerifierStatusChanged { verifier: v.verifier, active });
        Ok(())
    }

    pub fn anchor_audit_root(ctx: Context<AdminOnly>, root: [u8; 32]) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.latest_audit_root = root;
        c.audit_root_count = c.audit_root_count.saturating_add(1);
        emit!(AuditRootAnchored { root, index: c.audit_root_count, timestamp: now()? });
        Ok(())
    }

    // -------------------------------------------------------------- providers

    pub fn register_provider(ctx: Context<RegisterProvider>) -> Result<()> {
        let p = &mut ctx.accounts.provider;
        p.owner = ctx.accounts.owner.key();
        p.stake = 0;
        p.completed = 0;
        p.slashed = 0;
        p.active_jobs = 0;
        p.active = true;
        p.bump = ctx.bumps.provider;
        emit!(ProviderRegistered { provider: p.owner });
        Ok(())
    }

    pub fn stake_provider(ctx: Context<StakeProvider>, amount: u64) -> Result<()> {
        require!(amount > 0, VerityError::ZeroAmount);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.provider.to_account_info(),
                },
            ),
            amount,
        )?;
        let p = &mut ctx.accounts.provider;
        p.stake = p.stake.checked_add(amount).ok_or(VerityError::MathOverflow)?;
        emit!(ProviderStaked { provider: p.owner, amount, total_stake: p.stake });
        Ok(())
    }

    pub fn unstake_provider(ctx: Context<UnstakeProvider>, amount: u64) -> Result<()> {
        require!(amount > 0, VerityError::ZeroAmount);
        let provider_info = ctx.accounts.provider.to_account_info();
        let owner_info = ctx.accounts.owner.to_account_info();
        let p = &mut ctx.accounts.provider;
        require!(p.active_jobs == 0, VerityError::ProviderHasActiveJobs);
        require!(amount <= p.stake, VerityError::InsufficientStake);
        p.stake -= amount;
        let total = p.stake;
        let owner = p.owner;
        move_lamports(&provider_info, &owner_info, amount)?;
        emit!(ProviderUnstaked { provider: owner, amount, total_stake: total });
        Ok(())
    }

    // --------------------------------------------------------------- requests

    pub fn create_request(
        ctx: Context<CreateRequest>,
        program_hash: [u8; 32],
        input_hash: [u8; 32],
        input_uri_hash: [u8; 32],
        bounty: u64,
        deadline: i64,
    ) -> Result<()> {
        let t = now()?;
        require!(bounty > 0, VerityError::ZeroBounty);
        require!(deadline > t, VerityError::DeadlineInPast);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.requester.to_account_info(),
                    to: ctx.accounts.request.to_account_info(),
                },
            ),
            bounty,
        )?;

        let request_key = ctx.accounts.request.key();
        let config = &mut ctx.accounts.config;
        let id = config.request_count;
        config.request_count = id.checked_add(1).ok_or(VerityError::MathOverflow)?;

        let r = &mut ctx.accounts.request;
        r.id = id;
        r.requester = ctx.accounts.requester.key();
        r.program_hash = program_hash;
        r.input_hash = input_hash;
        r.input_uri_hash = input_uri_hash;
        r.bounty = bounty;
        r.deadline = deadline;
        r.status = RequestStatus::Open;
        r.provider = Pubkey::default();
        r.created_at = t;
        r.receipt_at = 0;
        r.attest_count_match = 0;
        r.attest_count_mismatch = 0;
        r.attest_count_total = 0;
        r.settled = false;
        r.bump = ctx.bumps.request;

        emit!(RequestCreated {
            request: request_key,
            id,
            requester: r.requester,
            program_hash,
            input_hash,
            bounty,
            deadline,
        });
        Ok(())
    }

    pub fn claim_request(ctx: Context<ClaimRequest>) -> Result<()> {
        let t = now()?;
        let request_key = ctx.accounts.request.key();
        let config = &ctx.accounts.config;
        let p = &mut ctx.accounts.provider;
        require!(p.active, VerityError::ProviderInactive);
        require!(p.stake >= config.min_provider_stake, VerityError::InsufficientStake);

        let r = &mut ctx.accounts.request;
        require!(r.status == RequestStatus::Open, VerityError::InvalidStatus);
        require!(t <= r.deadline, VerityError::DeadlinePassed);

        r.provider = p.owner;
        r.status = RequestStatus::Claimed;
        p.active_jobs = p.active_jobs.checked_add(1).ok_or(VerityError::MathOverflow)?;

        emit!(RequestClaimed { request: request_key, provider: p.owner });
        Ok(())
    }

    /// Must be preceded (immediately) by an Ed25519Program instruction that
    /// verifies `signature` by the provider over the canonical receipt bytes.
    pub fn submit_receipt(
        ctx: Context<SubmitReceipt>,
        output_hash: [u8; 32],
        trace_root: [u8; 32],
        fuel_used: u64,
        signature: [u8; 64],
    ) -> Result<()> {
        let t = now()?;
        let request_key = ctx.accounts.request.key();
        let provider_key = ctx.accounts.provider_owner.key();
        let r = &mut ctx.accounts.request;
        require!(r.status == RequestStatus::Claimed, VerityError::InvalidStatus);
        require_keys_eq!(r.provider, provider_key, VerityError::NotAssignedProvider);
        require!(t <= r.deadline, VerityError::DeadlinePassed);

        let msg = receipt_message(
            &request_key,
            &r.program_hash,
            &r.input_hash,
            &output_hash,
            &trace_root,
            fuel_used,
        );
        let ix_info = ctx.accounts.instructions.to_account_info();
        let cur = ix_sysvar::load_current_index_checked(&ix_info)?;
        require!(cur > 0, VerityError::InvalidSignatureInstruction);
        let ed_ix = ix_sysvar::load_instruction_at_checked((cur - 1) as usize, &ix_info)?;
        ed25519::verify_ed25519_ix(&ed_ix, cur - 1, provider_key.as_ref(), &msg, &signature)?;

        let rc = &mut ctx.accounts.receipt;
        rc.request = request_key;
        rc.provider = provider_key;
        rc.output_hash = output_hash;
        rc.trace_root = trace_root;
        rc.fuel_used = fuel_used;
        rc.signature = signature;
        rc.submitted_at = t;
        rc.bump = ctx.bumps.receipt;

        r.status = RequestStatus::AwaitingVerification;
        r.receipt_at = t;

        emit!(ReceiptSubmitted {
            request: request_key,
            provider: provider_key,
            output_hash,
            trace_root,
            fuel_used,
        });
        Ok(())
    }

    /// Anyone may attest; only active registered verifiers count toward quorum.
    pub fn attest(
        ctx: Context<Attest>,
        output_hash: [u8; 32],
        trace_root: [u8; 32],
        fuel_used: u64,
    ) -> Result<()> {
        let t = now()?;
        let request_key = ctx.accounts.request.key();
        let verifier_key = ctx.accounts.verifier.key();
        let rc = &ctx.accounts.receipt;
        let r = &mut ctx.accounts.request;
        require!(
            r.status == RequestStatus::AwaitingVerification || r.status == RequestStatus::Disputed,
            VerityError::InvalidStatus
        );
        require_keys_neq!(verifier_key, r.provider, VerityError::ProviderCannotAttest);

        let matches = output_hash == rc.output_hash
            && trace_root == rc.trace_root
            && fuel_used == rc.fuel_used;

        let counted = match ctx.accounts.verifier_record.as_mut() {
            Some(v) if v.active => {
                v.attestations = v.attestations.saturating_add(1);
                true
            }
            _ => false,
        };

        r.attest_count_total = r.attest_count_total.saturating_add(1);
        if counted {
            if matches {
                r.attest_count_match = r.attest_count_match.saturating_add(1);
            } else {
                r.attest_count_mismatch = r.attest_count_mismatch.saturating_add(1);
            }
        }

        let a = &mut ctx.accounts.attestation;
        a.request = request_key;
        a.verifier = verifier_key;
        a.output_hash = output_hash;
        a.trace_root = trace_root;
        a.fuel_used = fuel_used;
        a.matches = matches;
        a.counted = counted;
        a.attested_at = t;
        a.bump = ctx.bumps.attestation;

        emit!(Attested { request: request_key, verifier: verifier_key, matches, counted });
        Ok(())
    }

    // --------------------------------------------------------------- disputes

    pub fn open_dispute(ctx: Context<OpenDispute>, claimed_output_hash: [u8; 32]) -> Result<()> {
        let t = now()?;
        let request_key = ctx.accounts.request.key();
        let challenger_key = ctx.accounts.challenger.key();
        let stake = ctx.accounts.config.min_dispute_stake;
        {
            let r = &ctx.accounts.request;
            require!(r.status == RequestStatus::AwaitingVerification, VerityError::InvalidStatus);
            require_keys_neq!(challenger_key, r.provider, VerityError::ProviderCannotDispute);
            require!(
                claimed_output_hash != ctx.accounts.receipt.output_hash,
                VerityError::ClaimMatchesReceipt
            );
        }

        if stake > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.challenger.to_account_info(),
                        to: ctx.accounts.dispute.to_account_info(),
                    },
                ),
                stake,
            )?;
        }

        let d = &mut ctx.accounts.dispute;
        d.request = request_key;
        d.challenger = challenger_key;
        d.stake = stake;
        d.claimed_output_hash = claimed_output_hash;
        d.status = DisputeStatus::Open;
        d.opened_at = t;
        d.resolved_at = 0;
        d.bump = ctx.bumps.dispute;

        ctx.accounts.request.status = RequestStatus::Disputed;

        emit!(DisputeOpened {
            request: request_key,
            challenger: challenger_key,
            stake,
            claimed_output_hash,
        });
        Ok(())
    }

    /// Permissionless. `remaining_accounts` = pairs of
    /// (attestation PDA, verifier wallet [writable]) supporting the challenger.
    /// Challenger wins if >= quorum counted mismatch attestations agree with
    /// the claimed output hash: provider is slashed (half to challenger, half
    /// split among supporting verifiers), challenger stake returned, request
    /// Rejected (bounty refundable via `expire_request`).
    /// Otherwise, once the challenge window since the dispute opened has
    /// elapsed, the provider wins and receives the challenger's stake.
    pub fn resolve_dispute(ctx: Context<ResolveDispute>) -> Result<()> {
        let t = now()?;
        let request_key = ctx.accounts.request.key();
        let config = &ctx.accounts.config;
        require!(
            ctx.accounts.request.status == RequestStatus::Disputed
                && ctx.accounts.dispute.status == DisputeStatus::Open,
            VerityError::InvalidStatus
        );

        let claimed = ctx.accounts.dispute.claimed_output_hash;
        let rem = ctx.remaining_accounts;
        require!(rem.len() % 2 == 0, VerityError::InvalidEvidence);

        let mut seen: Vec<Pubkey> = Vec::new();
        let mut wallets: Vec<AccountInfo> = Vec::new();
        for pair in rem.chunks(2) {
            let (att_info, wallet) = (&pair[0], &pair[1]);
            require_keys_eq!(*att_info.owner, crate::ID, VerityError::InvalidEvidence);
            let att = {
                let data = att_info.try_borrow_data()?;
                Attestation::try_deserialize(&mut &data[..])?
            };
            require_keys_eq!(att.request, request_key, VerityError::InvalidEvidence);
            require!(att.counted && !att.matches, VerityError::InvalidEvidence);
            require!(att.output_hash == claimed, VerityError::InvalidEvidence);
            require_keys_eq!(wallet.key(), att.verifier, VerityError::InvalidEvidence);
            require!(wallet.is_writable, VerityError::InvalidEvidence);
            require!(!seen.contains(&att.verifier), VerityError::DuplicateVerifier);
            seen.push(att.verifier);
            wallets.push(wallet.clone());
        }

        let challenger_won = wallets.len() >= config.required_attestations as usize;
        let provider_info = ctx.accounts.provider.to_account_info();
        let dispute_info = ctx.accounts.dispute.to_account_info();
        let challenger_info = ctx.accounts.challenger.to_account_info();
        let provider_owner_info = ctx.accounts.provider_owner.to_account_info();
        let dispute_stake = ctx.accounts.dispute.stake;
        let mut slashed = 0u64;

        if challenger_won {
            let p = &mut ctx.accounts.provider;
            slashed = p.stake.min(config.min_provider_stake);
            p.stake -= slashed;
            p.slashed = p.slashed.saturating_add(1);
            p.active_jobs = p.active_jobs.saturating_sub(1);

            let n = wallets.len() as u64;
            let each = (slashed / 2) / n;
            let to_challenger = slashed - each * n;
            move_lamports(&provider_info, &challenger_info, to_challenger)?;
            for w in wallets.iter() {
                move_lamports(&provider_info, w, each)?;
            }
            move_lamports(&dispute_info, &challenger_info, dispute_stake)?;

            ctx.accounts.request.status = RequestStatus::Rejected;
            ctx.accounts.dispute.status = DisputeStatus::ChallengerWon;
        } else {
            let opened = ctx.accounts.dispute.opened_at;
            let ends = opened
                .checked_add(config.challenge_window_secs)
                .ok_or(VerityError::MathOverflow)?;
            require!(t >= ends, VerityError::ChallengeWindowOpen);
            move_lamports(&dispute_info, &provider_owner_info, dispute_stake)?;
            ctx.accounts.request.status = RequestStatus::AwaitingVerification;
            ctx.accounts.dispute.status = DisputeStatus::ProviderWon;
        }
        ctx.accounts.dispute.resolved_at = t;

        let winner = if challenger_won {
            ctx.accounts.challenger.key()
        } else {
            ctx.accounts.provider_owner.key()
        };
        emit!(DisputeResolved { request: request_key, challenger_won, winner, slashed });
        Ok(())
    }

    // ------------------------------------------------------------- settlement

    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        let t = now()?;
        let request_key = ctx.accounts.request.key();
        let config = &ctx.accounts.config;
        let request_info = ctx.accounts.request.to_account_info();
        let owner_info = ctx.accounts.provider_owner.to_account_info();

        let r = &mut ctx.accounts.request;
        require!(r.status == RequestStatus::AwaitingVerification, VerityError::InvalidStatus);
        let ends = r
            .receipt_at
            .checked_add(config.challenge_window_secs)
            .ok_or(VerityError::MathOverflow)?;
        require!(t >= ends, VerityError::ChallengeWindowOpen);
        require!(
            r.attest_count_match >= config.required_attestations,
            VerityError::QuorumNotReached
        );
        r.status = RequestStatus::Verified;
        r.settled = true;
        let bounty = r.bounty;

        let p = &mut ctx.accounts.provider;
        p.completed = p.completed.saturating_add(1);
        p.active_jobs = p.active_jobs.saturating_sub(1);

        move_lamports(&request_info, &owner_info, bounty)?;
        emit!(Finalized { request: request_key, provider: p.owner, bounty });
        Ok(())
    }

    /// Refunds the bounty to the requester when (a) an Open/Claimed request
    /// passed its deadline without a receipt, or (b) the request was Rejected
    /// through a dispute. Permissionless.
    pub fn expire_request(ctx: Context<ExpireRequest>) -> Result<()> {
        let t = now()?;
        let request_key = ctx.accounts.request.key();
        let request_info = ctx.accounts.request.to_account_info();
        let requester_info = ctx.accounts.requester.to_account_info();

        let r = &mut ctx.accounts.request;
        require!(!r.settled, VerityError::InvalidStatus);
        match r.status {
            RequestStatus::Open => {
                require!(t > r.deadline, VerityError::DeadlineNotReached);
                r.status = RequestStatus::Expired;
            }
            RequestStatus::Claimed => {
                require!(t > r.deadline, VerityError::DeadlineNotReached);
                let p = ctx
                    .accounts
                    .provider
                    .as_mut()
                    .ok_or(VerityError::ProviderAccountRequired)?;
                p.active_jobs = p.active_jobs.saturating_sub(1);
                r.status = RequestStatus::Expired;
            }
            RequestStatus::Rejected => {}
            _ => return err!(VerityError::InvalidStatus),
        }
        r.settled = true;
        let bounty = r.bounty;
        move_lamports(&request_info, &requester_info, bounty)?;
        emit!(Expired { request: request_key, refunded: bounty });
        Ok(())
    }
}

// =================================================================== accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(verifier: Pubkey)]
pub struct RegisterVerifier<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + VerifierRecord::INIT_SPACE,
        seeds = [VERIFIER_SEED, verifier.as_ref()],
        bump
    )]
    pub verifier_record: Account<'info, VerifierRecord>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetVerifierActive<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [VERIFIER_SEED, verifier_record.verifier.as_ref()],
        bump = verifier_record.bump
    )]
    pub verifier_record: Account<'info, VerifierRecord>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RegisterProvider<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Provider::INIT_SPACE,
        seeds = [PROVIDER_SEED, owner.key().as_ref()],
        bump
    )]
    pub provider: Account<'info, Provider>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StakeProvider<'info> {
    #[account(mut, seeds = [PROVIDER_SEED, owner.key().as_ref()], bump = provider.bump)]
    pub provider: Account<'info, Provider>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakeProvider<'info> {
    #[account(mut, seeds = [PROVIDER_SEED, owner.key().as_ref()], bump = provider.bump)]
    pub provider: Account<'info, Provider>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateRequest<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = requester,
        space = 8 + Request::INIT_SPACE,
        seeds = [REQUEST_SEED, requester.key().as_ref(), &config.request_count.to_le_bytes()],
        bump
    )]
    pub request: Account<'info, Request>,
    #[account(mut)]
    pub requester: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRequest<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub request: Account<'info, Request>,
    #[account(mut, seeds = [PROVIDER_SEED, provider_owner.key().as_ref()], bump = provider.bump)]
    pub provider: Account<'info, Provider>,
    pub provider_owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct SubmitReceipt<'info> {
    #[account(mut)]
    pub request: Account<'info, Request>,
    #[account(
        init,
        payer = provider_owner,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, request.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, Receipt>,
    #[account(mut)]
    pub provider_owner: Signer<'info>,
    /// CHECK: verified by address constraint (instructions sysvar).
    #[account(address = ix_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Attest<'info> {
    #[account(mut)]
    pub request: Account<'info, Request>,
    #[account(seeds = [RECEIPT_SEED, request.key().as_ref()], bump = receipt.bump)]
    pub receipt: Account<'info, Receipt>,
    #[account(
        init,
        payer = verifier,
        space = 8 + Attestation::INIT_SPACE,
        seeds = [ATTESTATION_SEED, request.key().as_ref(), verifier.key().as_ref()],
        bump
    )]
    pub attestation: Account<'info, Attestation>,
    /// Optional: pass the verifier's registry record to have the attestation count.
    #[account(mut, seeds = [VERIFIER_SEED, verifier.key().as_ref()], bump)]
    pub verifier_record: Option<Account<'info, VerifierRecord>>,
    #[account(mut)]
    pub verifier: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub request: Account<'info, Request>,
    #[account(seeds = [RECEIPT_SEED, request.key().as_ref()], bump = receipt.bump)]
    pub receipt: Account<'info, Receipt>,
    #[account(
        init,
        payer = challenger,
        space = 8 + Dispute::INIT_SPACE,
        seeds = [DISPUTE_SEED, request.key().as_ref()],
        bump
    )]
    pub dispute: Account<'info, Dispute>,
    #[account(mut)]
    pub challenger: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub request: Account<'info, Request>,
    #[account(mut, seeds = [DISPUTE_SEED, request.key().as_ref()], bump = dispute.bump)]
    pub dispute: Account<'info, Dispute>,
    #[account(mut, seeds = [PROVIDER_SEED, request.provider.as_ref()], bump = provider.bump)]
    pub provider: Account<'info, Provider>,
    /// CHECK: provider wallet; verified by address constraint.
    #[account(mut, address = request.provider @ VerityError::AccountMismatch)]
    pub provider_owner: UncheckedAccount<'info>,
    /// CHECK: challenger wallet; verified by address constraint.
    #[account(mut, address = dispute.challenger @ VerityError::AccountMismatch)]
    pub challenger: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub request: Account<'info, Request>,
    #[account(mut, seeds = [PROVIDER_SEED, request.provider.as_ref()], bump = provider.bump)]
    pub provider: Account<'info, Provider>,
    /// CHECK: provider wallet receiving the bounty; verified by address constraint.
    #[account(mut, address = request.provider @ VerityError::AccountMismatch)]
    pub provider_owner: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ExpireRequest<'info> {
    #[account(mut)]
    pub request: Account<'info, Request>,
    /// CHECK: requester wallet receiving the refund; verified by address constraint.
    #[account(mut, address = request.requester @ VerityError::AccountMismatch)]
    pub requester: UncheckedAccount<'info>,
    /// Required only if the request is in `Claimed` status.
    #[account(mut, seeds = [PROVIDER_SEED, request.provider.as_ref()], bump)]
    pub provider: Option<Account<'info, Provider>>,
}
