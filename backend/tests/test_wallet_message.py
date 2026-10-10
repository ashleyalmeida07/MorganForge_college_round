"""Sign-In-With-Solana wallet-link message: bound to the site origin, the wallet and the cluster."""
import pytest
from fastapi import HTTPException

from app.config import settings
from app.routes.auth_wallet import build_message, resolve_origin

WALLET = "AxYv9q3deyufks6sT2hDSGG7Bt98TojNPxitDt62N3rZ"


def _msg(**kw):
    args = dict(origin="https://verity.vercel.app", wallet=WALLET, nonce="0123456789abcdef",
                issued_at="2026-10-11T10:00:00Z", expires_at="2026-10-11T10:10:00Z", email="a@b.c")
    return build_message(**{**args, **kw})


def test_message_is_siws_format(monkeypatch):
    monkeypatch.setattr(settings, "cluster", "devnet")
    lines = _msg().split("\n")
    assert lines[0] == "verity.vercel.app wants you to sign in with your Solana account:"
    assert lines[1] == WALLET
    assert "URI: https://verity.vercel.app" in lines
    assert "Version: 1" in lines
    assert "Chain ID: devnet" in lines
    assert "Nonce: 0123456789abcdef" in lines
    assert "Issued At: 2026-10-11T10:00:00Z" in lines
    assert "Expiration Time: 2026-10-11T10:10:00Z" in lines
    assert "(a@b.c)" in lines[3]


def test_mainnet_chain_id(monkeypatch):
    monkeypatch.setattr(settings, "cluster", "mainnet-beta")
    assert "Chain ID: mainnet" in _msg().split("\n")


def test_localhost_port_kept_in_domain():
    assert _msg(origin="http://localhost:3000").startswith("localhost:3000 wants you")


def test_resolve_origin_only_trusts_allowed_origins(monkeypatch):
    monkeypatch.setattr(settings, "frontend_origin", "http://localhost:3000,https://verity.vercel.app")
    assert resolve_origin("https://verity.vercel.app") == "https://verity.vercel.app"
    assert resolve_origin("https://verity.vercel.app/") == "https://verity.vercel.app"
    assert resolve_origin("https://evil.example") == "http://localhost:3000"
    assert resolve_origin(None) == "http://localhost:3000"


def test_resolve_origin_requires_config(monkeypatch):
    monkeypatch.setattr(settings, "frontend_origin", "")
    with pytest.raises(HTTPException):
        resolve_origin(None)
