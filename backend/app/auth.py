"""Supabase JWT auth (Google login) as FastAPI dependencies."""
import hmac
import time
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException

from app.config import settings
from app.db import get_db, table

_jwks_client: jwt.PyJWKClient | None = None
_token_cache: dict[str, tuple[float, dict[str, Any]]] = {}


@dataclass
class User:
    id: str
    email: str | None
    role: str = "user"

    @property
    def is_admin(self) -> bool:
        return self.role == "admin" or (self.email or "").lower() in settings.admin_email_list


def _is_dev_admin_token(token: str) -> bool:
    """Opt-in shared secret for local/E2E admin calls. Off unless DEV_ADMIN_TOKEN is set; never on mainnet."""
    secret = settings.dev_admin_token
    if not secret or settings.cluster == "mainnet-beta":
        return False
    return hmac.compare_digest(token.encode(), secret.encode())


def _decode(token: str) -> dict[str, Any]:
    cached = _token_cache.get(token)
    if cached and cached[0] > time.time():
        return cached[1]

    claims: dict[str, Any] | None = None
    if settings.supabase_jwt_secret:
        try:
            claims = jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
        except jwt.PyJWTError:
            claims = None
    if claims is None:
        try:
            global _jwks_client
            if _jwks_client is None:
                _jwks_client = jwt.PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")
            key = _jwks_client.get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key.key, algorithms=["ES256", "RS256"], audience="authenticated")
        except Exception:
            claims = None
    if claims is None:
        # Fallback: ask Supabase Auth directly.
        try:
            u = get_db().auth.get_user(token).user
            claims = {"sub": u.id, "email": u.email, "user_metadata": u.user_metadata or {}, "exp": time.time() + 300}
        except Exception as e:
            raise HTTPException(401, "invalid or expired token") from e

    _token_cache[token] = (min(float(claims.get("exp", time.time() + 300)), time.time() + 300), claims)
    return claims


def _ensure_profile(claims: dict[str, Any]) -> str:
    uid, email = claims["sub"], claims.get("email")
    try:
        rows = table("profiles").select("role").eq("id", uid).limit(1).execute().data
        if rows:
            return rows[0].get("role") or "user"
        meta = claims.get("user_metadata") or {}
        table("profiles").upsert({
            "id": uid,
            "email": email,
            "display_name": meta.get("full_name") or meta.get("name"),
            "avatar_url": meta.get("avatar_url"),
        }).execute()
    except Exception:
        pass
    return "user"


def _user_from_header(authorization: str | None) -> User | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if _is_dev_admin_token(token):
        return User(id="dev-admin", email=None, role="admin")
    claims = _decode(token)
    role = _ensure_profile(claims)
    return User(id=claims["sub"], email=claims.get("email"), role=role)


async def get_current_user(authorization: str | None = Header(default=None)) -> User:
    user = _user_from_header(authorization)
    if user is None:
        raise HTTPException(401, "missing bearer token")
    return user


async def get_optional_user(authorization: str | None = Header(default=None)) -> User | None:
    try:
        return _user_from_header(authorization)
    except HTTPException:
        return None


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Admin = verified Supabase user with profiles.role='admin' or an email in ADMIN_EMAILS."""
    if not user.is_admin:
        raise HTTPException(403, "admin only")
    return user
