"""Google sign-in (OpenID Connect, authorization code flow with PKCE) and account bookkeeping.

AUTH_MODE=google uses Authlib's Starlette client. It fetches Google's discovery document, sends
`state`, `nonce` and an S256 PKCE challenge, keeps those in a short-lived signed cookie (`tc_oauth`), then
exchanges the code and validates the ID token (signature, iss, aud, exp, nonce) before we read any claim.
Users are keyed on the `sub` claim, never on email.

AUTH_MODE=mock skips Google entirely: login redirects straight to the callback with a fake profile,
so development and tests need no Google project.
"""

from __future__ import annotations

import logging
from urllib.parse import urlencode, urlsplit

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .config import Settings
from .db import utcnow
from .models import HistoryEntry, Map, UsageEvent, User

log = logging.getLogger(__name__)

GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration"


def build_oauth(settings: Settings):
    """The Authlib registry for AUTH_MODE=google, or None (mock mode, or not configured)."""
    if settings.auth_mode != "google":
        return None
    secret = settings.google_client_secret.get_secret_value().strip() if settings.google_client_secret else ""
    if not (settings.google_client_id or "").strip() or not secret:
        log.error("AUTH_MODE=google but GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set; sign-in is disabled")
        return None
    from authlib.integrations.starlette_client import OAuth

    oauth = OAuth()
    oauth.register(
        "google",
        client_id=settings.google_client_id,
        client_secret=secret,
        server_metadata_url=GOOGLE_DISCOVERY_URL,
        client_kwargs={"scope": "openid email profile", "code_challenge_method": "S256"},
    )
    return oauth


def safe_next(target: str | None) -> str:
    """Only same-site relative paths, so the login flow can't be turned into an open redirect."""
    if not target or not target.startswith("/") or target.startswith("//") or "\\" in target:
        return "/"
    parts = urlsplit(target)
    if parts.scheme or parts.netloc:
        return "/"
    return target[:300]


def with_param(target: str, key: str, value: str) -> str:
    sep = "&" if "?" in target else "?"
    return f"{target}{sep}{urlencode({key: value})}"


def mock_profile(name: str | None) -> dict[str, str | None]:
    handle = "".join(ch for ch in (name or "demo").lower() if ch.isalnum())[:24] or "demo"
    display = "Demo User" if handle == "demo" else handle.capitalize()
    return {"sub": f"mock-{handle}", "email": f"{handle}@example.com", "name": display, "picture": None}


def upsert_user(db: Session, *, sub: str, email: str | None, name: str | None, avatar_url: str | None) -> User:
    user = db.scalar(select(User).where(User.google_sub == sub))
    now = utcnow()
    if user is None:
        user = User(google_sub=sub, email=email, name=name, avatar_url=avatar_url, created_at=now, last_login=now)
        db.add(user)
        db.flush()
    else:
        user.email, user.name, user.avatar_url, user.last_login = email, name, avatar_url, now
    return user


def claim_visitor_data(db: Session, user_id: int, client_hash: str) -> None:
    """Move this browser's anonymous maps, history and usage into the account.

    Claiming the usage events is what makes the free-tier window carry over: signing in never resets it.
    """
    for model in (Map, HistoryEntry, UsageEvent):
        db.execute(
            update(model).where(model.client_hash == client_hash, model.user_id.is_(None)).values(user_id=user_id)
        )
