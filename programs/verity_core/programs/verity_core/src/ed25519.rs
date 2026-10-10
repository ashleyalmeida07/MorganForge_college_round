use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;

use crate::errors::VerityError;

/// Ed25519SigVerify111111111111111111111111111
pub const ED25519_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    3, 125, 70, 214, 124, 147, 251, 190, 18, 249, 66, 143, 131, 141, 64, 255, 5, 112, 116, 73,
    39, 244, 138, 100, 252, 202, 112, 68, 128, 0, 0, 0,
]);

/// Verifies that `ix` is an Ed25519 precompile instruction (at index `own_index`
/// in the transaction) that checked exactly `sig` by `pubkey` over `msg`.
///
/// Layout: num_signatures(u8)=1, padding(u8), then 7 x u16 LE:
/// sig_offset, sig_ix, pk_offset, pk_ix, msg_offset, msg_size, msg_ix.
pub fn verify_ed25519_ix(
    ix: &Instruction,
    own_index: u16,
    pubkey: &[u8],
    msg: &[u8],
    sig: &[u8],
) -> Result<()> {
    require_keys_eq!(ix.program_id, ED25519_PROGRAM_ID, VerityError::InvalidSignatureInstruction);
    require!(ix.accounts.is_empty(), VerityError::InvalidSignatureInstruction);
    let d = &ix.data;
    require!(d.len() >= 16 && d[0] == 1, VerityError::InvalidSignatureInstruction);

    let r = |i: usize| u16::from_le_bytes([d[i], d[i + 1]]);
    let (sig_off, sig_ix) = (r(2) as usize, r(4));
    let (pk_off, pk_ix) = (r(6) as usize, r(8));
    let (msg_off, msg_len, msg_ix) = (r(10) as usize, r(12) as usize, r(14));

    // Data must live inside the Ed25519 instruction itself.
    let same = |i: u16| i == u16::MAX || i == own_index;
    require!(same(sig_ix) && same(pk_ix) && same(msg_ix), VerityError::InvalidSignatureInstruction);

    let get = |off: usize, len: usize| d.get(off..off.checked_add(len)?);
    let pk = get(pk_off, 32).ok_or(VerityError::InvalidSignatureInstruction)?;
    let s = get(sig_off, 64).ok_or(VerityError::InvalidSignatureInstruction)?;
    let m = get(msg_off, msg_len).ok_or(VerityError::InvalidSignatureInstruction)?;

    require!(pk == pubkey && s == sig && m == msg, VerityError::SignatureMismatch);
    Ok(())
}
