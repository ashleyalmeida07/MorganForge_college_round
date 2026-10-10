//! Groth16 (BN254) verification on top of Solana's alt_bn128 syscalls.
//!
//! Encodings are EIP-197 big-endian: G1 = x || y (64 bytes), G2 = x.c1 || x.c0 ||
//! y.c1 || y.c0 (128 bytes), scalars 32 bytes. Checks
//!     e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
//! with vk_x = IC[0] + sum_i input_i * IC[i+1].

use solana_bn254::prelude::{alt_bn128_addition, alt_bn128_multiplication, alt_bn128_pairing};

use crate::vk::{NR_PUBLIC_INPUTS, VK_ALPHA_G1, VK_BETA_G2, VK_DELTA_G2, VK_GAMMA_G2, VK_IC};

/// BN254 base field modulus p.
const FIELD_P: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];
/// BN254 scalar field modulus r (public inputs must be < r).
const FIELD_R: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

#[derive(Debug, PartialEq, Eq)]
pub enum Groth16Error {
    InputNotInField,
    InvalidPoint,
    PairingFailed,
    ProofInvalid,
}

/// Big-endian 256-bit `a - b` (requires a >= b).
fn sub_be(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let mut d = a[i] as i16 - b[i] as i16 - borrow;
        borrow = if d < 0 {
            d += 256;
            1
        } else {
            0
        };
        out[i] = d as u8;
    }
    out
}

/// Negate a G1 point: (x, y) -> (x, p - y). The point at infinity stays as is.
pub fn negate_g1(point: &[u8; 64]) -> [u8; 64] {
    let mut out = *point;
    let y: [u8; 32] = point[32..].try_into().unwrap();
    if y.iter().any(|b| *b != 0) {
        out[32..].copy_from_slice(&sub_be(&FIELD_P, &y));
    }
    out
}

/// Encode a u128 as a 32-byte big-endian scalar.
pub fn scalar_u128(v: u128) -> [u8; 32] {
    let mut s = [0u8; 32];
    s[16..].copy_from_slice(&v.to_be_bytes());
    s
}

pub fn verify(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]; NR_PUBLIC_INPUTS],
) -> Result<(), Groth16Error> {
    // vk_x = IC0 + sum(input_i * IC_{i+1})
    let mut vk_x: [u8; 64] = VK_IC[0];
    for (i, input) in public_inputs.iter().enumerate() {
        if input >= &FIELD_R {
            return Err(Groth16Error::InputNotInField);
        }
        let mut mul_in = [0u8; 96];
        mul_in[..64].copy_from_slice(&VK_IC[i + 1]);
        mul_in[64..].copy_from_slice(input);
        let term = alt_bn128_multiplication(&mul_in).map_err(|_| Groth16Error::InvalidPoint)?;
        let mut add_in = [0u8; 128];
        add_in[..64].copy_from_slice(&vk_x);
        add_in[64..].copy_from_slice(&term);
        let sum = alt_bn128_addition(&add_in).map_err(|_| Groth16Error::InvalidPoint)?;
        vk_x.copy_from_slice(&sum);
    }

    let mut pairing_in = [0u8; 4 * 192];
    let neg_a = negate_g1(proof_a);
    for (k, (g1, g2)) in [
        (&neg_a, proof_b),
        (&VK_ALPHA_G1, &VK_BETA_G2),
        (&vk_x, &VK_GAMMA_G2),
        (proof_c, &VK_DELTA_G2),
    ]
    .iter()
    .enumerate()
    {
        pairing_in[k * 192..k * 192 + 64].copy_from_slice(&g1[..]);
        pairing_in[k * 192 + 64..k * 192 + 192].copy_from_slice(&g2[..]);
    }
    let res = alt_bn128_pairing(&pairing_in).map_err(|_| Groth16Error::PairingFailed)?;
    if res.len() == 32 && res[31] == 1 && res[..31].iter().all(|b| *b == 0) {
        Ok(())
    } else {
        Err(Groth16Error::ProofInvalid)
    }
}
