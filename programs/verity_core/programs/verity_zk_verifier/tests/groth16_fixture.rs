//! Native test of the on-chain Groth16 verifier against a proof produced by snarkjs
//! (zk/scripts/test.mjs writes tests/fixture.json). Runs with `cargo test` on the host;
//! solana-bn254 falls back to arkworks off-chain, same math as the syscalls.

use verity_zk_verifier::groth16::{negate_g1, scalar_u128, verify, Groth16Error};

struct Fixture {
    a: [u8; 64],
    b: [u8; 128],
    c: [u8; 64],
    inputs: [[u8; 32]; 7],
}

fn load() -> Fixture {
    let raw = include_str!("fixture.json");
    let v: serde_json::Value = serde_json::from_str(raw).unwrap();
    let bytes = |k: &str| -> Vec<u8> { v[k].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u8).collect() };
    let mut inputs = [[0u8; 32]; 7];
    for (i, s) in v["public_signals"].as_array().unwrap().iter().enumerate() {
        let n: u128 = s.as_str().unwrap().parse().unwrap();
        inputs[i] = scalar_u128(n);
    }
    Fixture {
        a: bytes("proof_a").try_into().unwrap(),
        b: bytes("proof_b").try_into().unwrap(),
        c: bytes("proof_c").try_into().unwrap(),
        inputs,
    }
}

#[test]
fn valid_proof_verifies() {
    let f = load();
    assert_eq!(verify(&f.a, &f.b, &f.c, &f.inputs), Ok(()));
}

#[test]
fn forged_net_pay_rejected() {
    let mut f = load();
    f.inputs[1] = scalar_u128(850_000); // claim net pay 8500.00 instead of 7500.00
    assert_eq!(verify(&f.a, &f.b, &f.c, &f.inputs), Err(Groth16Error::ProofInvalid));
}

#[test]
fn proof_bound_to_request() {
    let mut f = load();
    f.inputs[6] = scalar_u128(1);
    assert_eq!(verify(&f.a, &f.b, &f.c, &f.inputs), Err(Groth16Error::ProofInvalid));
}

#[test]
fn negated_a_rejected() {
    let f = load();
    let neg = negate_g1(&f.a);
    assert!(verify(&neg, &f.b, &f.c, &f.inputs).is_err());
}
