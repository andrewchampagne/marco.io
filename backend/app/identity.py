"""Who is asking: a signed anonymous visitor cookie, a salted IP hash, and an optional signed-in session.

Nothing here stores a raw IP. The visitor id is random and kept in a signed cookie; the database only
sees HMACs of it and of the IP, keyed from SESSION_SECRET (or IP_HASH_SALT for the IP). IPv6
addresses are reduced to their /64 prefix first, so rotating addresses within one allocation doesn't
reset the per-IP quota.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import re
import secrets
from dataclasses import dataclass
from http.cookies import SimpleCookie

from fastapi import Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeSerializer, URLSafeTimedSerializer
from starlette.datastructures import MutableHeaders
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings
from .models import User

VISITOR_COOKIE = "tc_vid"
SESSION_COOKIE = "tc_session"
OAUTH_COOKIE = "tc_oauth"
VISITOR_MAX_AGE = 400 * 24 * 3600  # the longest lifetime browsers honour
_VISITOR_ID = re.compile(r"^[A-Za-z0-9_-]{16,64}$")

SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
}


def _derive(settings: Settings, label: str) -> bytes:
    return hmac.new(settings.session_secret.get_secret_value().encode(), label.encode(), hashlib.sha256).digest()


class Keys:
    """Every secret-derived key and signer, built once per app."""

    def __init__(self, settings: Settings):
        self.visitor = URLSafeSerializer(_derive(settings, "visitor-cookie").hex(), salt="tc-visitor")
        self.session = URLSafeTimedSerializer(_derive(settings, "session-cookie").hex(), salt="tc-session")
        self.oauth_secret = _derive(settings, "oauth-state").hex()
        self._client_key = _derive(settings, "client-hash")
        salt = settings.ip_hash_salt.get_secret_value().strip() if settings.ip_hash_salt is not None else ""
        self._ip_key = salt.encode() if salt else _derive(settings, "ip-hash")

    def client_hash(self, visitor_id: str) -> str:
        return hmac.new(self._client_key, visitor_id.encode(), hashlib.sha256).hexdigest()[:40]

    def ip_hash(self, ip: str) -> str:
        return hmac.new(self._ip_key, ip_bucket(ip).encode(), hashlib.sha256).hexdigest()[:40]


def ip_bucket(ip: str) -> str:
    try:
        addr = ipaddress.ip_address(ip.strip())
    except ValueError:
        return ip.strip().lower()
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:
            return str(addr.ipv4_mapped)
        return str(ipaddress.ip_network(f"{addr}/64", strict=False).network_address)
    return str(addr)


def client_ip_from_scope(scope: Scope, settings: Settings) -> str:
    ip = (scope.get("client") or ("0.0.0.0", 0))[0] or "0.0.0.0"
    if settings.trust_proxy_headers:
        wanted = settings.proxy_ip_header.lower().encode()
        for name, value in scope.get("headers") or []:
            if name == wanted:
                parts = [p.strip() for p in value.decode("latin-1").split(",") if p.strip()]
                if parts:
                    ip = parts[max(0, len(parts) - max(1, settings.trusted_proxy_hops))]
                break
    return ip


def _cookies(scope: Scope) -> dict[str, str]:
    jar: dict[str, str] = {}
    for name, value in scope.get("headers") or []:
        if name == b"cookie":
            parsed = SimpleCookie()
            try:
                parsed.load(value.decode("latin-1"))
            except Exception:  # noqa: BLE001 - a malformed cookie header must not break the request
                continue
            jar.update({k: m.value for k, m in parsed.items()})
    return jar


def cookie_header(name: str, value: str, *, max_age: int, secure: bool, httponly: bool = True) -> str:
    response = Response()
    response.set_cookie(name, value, max_age=max_age, path="/", secure=secure, httponly=httponly, samesite="lax")
    return response.headers["set-cookie"]


class VisitorMiddleware:
    """Ensures every API caller has a signed visitor id (stored in request.state) and adds security headers."""

    def __init__(self, app: ASGIApp, settings: Settings, keys: Keys):
        self.app, self.settings, self.keys = app, settings, keys

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        visitor_id, new_cookie = None, None
        raw = _cookies(scope).get(VISITOR_COOKIE)
        if raw:
            try:
                candidate = self.keys.visitor.loads(raw)
                visitor_id = candidate if isinstance(candidate, str) and _VISITOR_ID.match(candidate) else None
            except BadSignature:
                visitor_id = None
        if visitor_id is None:
            visitor_id = secrets.token_urlsafe(18)
            new_cookie = self.keys.visitor.dumps(visitor_id)
        state = scope.setdefault("state", {})
        state["visitor_id"] = visitor_id
        state["client_ip"] = client_ip_from_scope(scope, self.settings)
        is_api = scope.get("path", "").startswith("/api")

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for key, value in SECURITY_HEADERS.items():
                    if key not in headers:
                        headers[key] = value
                if new_cookie and is_api:
                    headers.append("set-cookie", cookie_header(
                        VISITOR_COOKIE, new_cookie, max_age=VISITOR_MAX_AGE, secure=self.settings.cookie_secure))
            await send(message)

        await self.app(scope, receive, send_wrapper)


@dataclass
class Identity:
    visitor_id: str
    client_hash: str
    ip_hash: str
    user: User | None

    @property
    def signed_in(self) -> bool:
        return self.user is not None

    @property
    def user_id(self) -> int | None:
        return self.user.id if self.user else None

    def lock_keys(self) -> list[str]:
        return [f"c:{self.client_hash}"] + ([f"u:{self.user.id}"] if self.user else [])


def read_session_user_id(request: Request, keys: Keys, settings: Settings) -> int | None:
    raw = request.cookies.get(SESSION_COOKIE)
    if not raw:
        return None
    try:
        data = keys.session.loads(raw, max_age=settings.session_max_age_days * 86400)
    except (BadSignature, SignatureExpired):
        return None
    uid = data.get("uid") if isinstance(data, dict) else None
    return uid if isinstance(uid, int) else None


def set_session_cookie(response: Response, user_id: int, keys: Keys, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE, keys.session.dumps({"uid": user_id}), max_age=settings.session_max_age_days * 86400,
        path="/", secure=settings.cookie_secure, httponly=True, samesite="lax",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax")


def get_identity(request: Request) -> Identity:
    """FastAPI dependency (sync, so FastAPI runs it in the threadpool)."""
    app = request.app
    settings: Settings = app.state.settings
    keys: Keys = app.state.keys
    visitor_id = request.state.visitor_id
    user = None
    uid = read_session_user_id(request, keys, settings)
    if uid is not None:
        with app.state.session_factory() as db:
            user = db.get(User, uid)
    return Identity(
        visitor_id=visitor_id,
        client_hash=keys.client_hash(visitor_id),
        ip_hash=keys.ip_hash(request.state.client_ip),
        user=user,
    )
