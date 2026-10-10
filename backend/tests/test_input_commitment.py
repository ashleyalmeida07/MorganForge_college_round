"""Unit self-check for the requester-signed input commitment (§4.4): pure crypto round-trip, no network/DB."""
from solders.keypair import Keypair

from app.chain.signer import input_commitment_message, verify_receipt


def test_input_commitment_roundtrip():
    kp = Keypair()
    msg = input_commitment_message(b"\x11" * 32, b"\x22" * 32, b"\x33" * 32)
    sig = bytes(kp.sign_message(msg))
    assert verify_receipt(str(kp.pubkey()), msg, sig)


def test_input_commitment_rejects_tampered_message():
    kp = Keypair()
    msg = input_commitment_message(b"\x11" * 32, b"\x22" * 32, b"\x33" * 32)
    sig = bytes(kp.sign_message(msg))
    tampered = input_commitment_message(b"\xff" * 32, b"\x22" * 32, b"\x33" * 32)
    assert not verify_receipt(str(kp.pubkey()), tampered, sig)


def test_input_commitment_rejects_wrong_signer():
    kp = Keypair()
    other = Keypair()
    msg = input_commitment_message(b"\x11" * 32, b"\x22" * 32, b"\x33" * 32)
    sig = bytes(kp.sign_message(msg))
    assert not verify_receipt(str(other.pubkey()), msg, sig)


if __name__ == "__main__":
    test_input_commitment_roundtrip()
    test_input_commitment_rejects_tampered_message()
    test_input_commitment_rejects_wrong_signer()
    print("ok")
