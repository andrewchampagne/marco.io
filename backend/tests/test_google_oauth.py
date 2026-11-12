"""AUTH_MODE=google without network: Google's endpoints are stubbed, our flow is real."""

import time
from urllib.parse import parse_qs, urlsplit

import pytest

from app.config import DEV_SESSION_SECRET
from app.main import create_app

from .conftest import make_settings

GOOGLE = dict(auth_mode="google", google_client_id="cid.apps.googleusercontent.com", google_client_secret="shh")
METADATA = {
    "issuer": "https://accounts.google.com",
    "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_endpoint": "https://oauth2.googleapis.com/token",
    "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
    "code_challenge_methods_supported": ["plain", "S256"],
}


def google_client(build):
    client = build(**GOOGLE)
    client.app.state.oauth.google.server_metadata.update({**METADATA, "_loaded_at": time.time()})
    return client


def test_login_redirect_uses_pkce_state_nonce_and_openid_scope(build):
    client = google_client(build)
    r = client.get("/api/auth/google/login?next=/m/abc123", follow_redirects=False)
    assert r.status_code == 302
    url = urlsplit(r.headers["location"])
    q = {k: v[0] for k, v in parse_qs(url.query).items()}
    assert url.netloc == "accounts.google.com" and url.path == "/o/oauth2/v2/auth"
    assert q["response_type"] == "code" and q["client_id"] == GOOGLE["google_client_id"]
    assert q["scope"].split() == ["openid", "email", "profile"]
    assert q["code_challenge_method"] == "S256" and len(q["code_challenge"]) >= 43
    assert q["state"] and q["nonce"] and q["prompt"] == "select_account"
    assert q["redirect_uri"] == "https://testserver/api/auth/google/callback"
    oauth_cookie = [v for k, v in r.headers.multi_items() if k == "set-cookie" and v.startswith("tc_oauth=")]
    assert oauth_cookie and "httponly" in oauth_cookie[0].lower() and "secure" in oauth_cookie[0].lower()


def test_public_base_url_overrides_redirect_uri(build):
    client = build(**GOOGLE, public_base_url="https://maps.example.com/")
    client.app.state.oauth.google.server_metadata.update({**METADATA, "_loaded_at": time.time()})
    r = client.get("/api/auth/google/login", follow_redirects=False)
    q = parse_qs(urlsplit(r.headers["location"]).query)
    assert q["redirect_uri"] == ["https://maps.example.com/api/auth/google/callback"]


def test_callback_signs_in_with_validated_claims(build, monkeypatch):
    client = google_client(build)
    google = client.app.state.oauth.google

    async def fake_exchange(request, **kwargs):
        # Authlib returns the ID-token claims under "userinfo" after verifying signature, iss, aud, exp and nonce.
        return {"userinfo": {"sub": "10769150350006150715113082367", "email": "ada@example.com", "email_verified": True,
                             "name": "Ada Example", "picture": "https://lh3.googleusercontent.com/a/abc"}}

    monkeypatch.setattr(google, "authorize_access_token", fake_exchange)
    r = client.get("/api/auth/google/callback?code=c&state=s", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/?signed_in=1"
    me = client.get("/api/me").json()
    assert me == {"signed_in": True, "name": "Ada Example", "email": "ada@example.com",
                  "avatar_url": "https://lh3.googleusercontent.com/a/abc"}


def test_user_cancel_and_failures_redirect_with_error(build, monkeypatch):
    client = google_client(build)
    r = client.get("/api/auth/google/callback?error=access_denied", follow_redirects=False)
    assert r.headers["location"] == "/?auth_error=cancelled"
    from authlib.integrations.starlette_client import OAuthError

    async def failing(request, **kwargs):
        raise OAuthError(error="mismatching_state")

    monkeypatch.setattr(client.app.state.oauth.google, "authorize_access_token", failing)
    r = client.get("/api/auth/google/callback?code=c&state=s", follow_redirects=False)
    assert r.headers["location"] == "/?auth_error=failed"
    assert client.get("/api/me").json()["signed_in"] is False


def test_google_mode_refuses_the_dev_session_secret(tmp_path):
    with pytest.raises(RuntimeError):
        create_app(make_settings(tmp_path, **GOOGLE, session_secret=DEV_SESSION_SECRET), serve_frontend=False)


def test_google_mode_without_credentials_reports_unconfigured(build):
    client = build(auth_mode="google")
    r = client.get("/api/auth/google/login", follow_redirects=False)
    assert r.status_code == 503 and r.json()["code"] == "auth_unconfigured"
