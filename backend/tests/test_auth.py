"""Admin gating in app.auth: no implicit admin on devnet, only verified admins or an explicit DEV_ADMIN_TOKEN."""
import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import auth
from app.config import settings

USERS = {
    "jwt-admin": {"sub": "u-admin", "email": "boss@example.com"},
    "jwt-user": {"sub": "u-user", "email": "someone@example.com"},
}


@pytest.fixture
def client(monkeypatch):
    def fake_decode(token):
        if token not in USERS:
            raise HTTPException(401, "invalid or expired token")
        return USERS[token]

    monkeypatch.setattr(auth, "_decode", fake_decode)
    monkeypatch.setattr(auth, "_ensure_profile", lambda claims: "user")
    monkeypatch.setattr(settings, "admin_emails", "boss@example.com")
    monkeypatch.setattr(settings, "cluster", "devnet")
    monkeypatch.setattr(settings, "dev_admin_token", "")

    app = FastAPI()

    @app.get("/admin")
    async def admin(user: auth.User = Depends(auth.require_admin)):
        return {"id": user.id}

    return TestClient(app)


def _get(client, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token is not None else {}
    return client.get("/admin", headers=headers)


def test_missing_token_is_401(client):
    assert _get(client).status_code == 401


def test_invalid_token_is_401(client):
    assert _get(client, "garbage").status_code == 401


@pytest.mark.parametrize("token", ["dev-admin-token", "admin", "dev-admin", "dev-anything"])
def test_legacy_dev_tokens_rejected_when_not_configured(client, token):
    assert _get(client, token).status_code == 401


def test_non_admin_user_is_403(client):
    assert _get(client, "jwt-user").status_code == 403


def test_admin_email_allowed(client):
    r = _get(client, "jwt-admin")
    assert r.status_code == 200 and r.json() == {"id": "u-admin"}


def test_profile_role_admin_allowed(client, monkeypatch):
    monkeypatch.setattr(auth, "_ensure_profile", lambda claims: "admin")
    assert _get(client, "jwt-user").status_code == 200


def test_dev_admin_token_only_exact_match(client, monkeypatch):
    monkeypatch.setattr(settings, "dev_admin_token", "s3cret-long-random")
    assert _get(client, "s3cret-long-random").status_code == 200
    assert _get(client, "s3cret-long-randomX").status_code == 401
    assert _get(client, "dev-s3cret").status_code == 401


def test_dev_admin_token_ignored_on_mainnet(client, monkeypatch):
    monkeypatch.setattr(settings, "dev_admin_token", "s3cret-long-random")
    monkeypatch.setattr(settings, "cluster", "mainnet-beta")
    assert _get(client, "s3cret-long-random").status_code == 401
