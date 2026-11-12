"""GET /api/auth/google/login, GET /api/auth/google/callback, POST /api/auth/logout."""

from __future__ import annotations

import logging
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

from ..auth import claim_visitor_data, mock_profile, safe_next, upsert_user, with_param
from ..errors import ApiError
from ..identity import Identity, clear_session_cookie, get_identity, set_session_cookie

log = logging.getLogger(__name__)
router = APIRouter()


def _callback_url(request: Request) -> str:
    base = request.app.state.settings.public_base_url
    if base:
        return base.rstrip("/") + "/api/auth/google/callback"
    return str(request.url_for("google_callback"))


@router.get("/api/auth/google/login")
async def google_login(request: Request, next: str = "/", mock_user: str | None = None):
    settings = request.app.state.settings
    request.session.clear()
    request.session["next"] = safe_next(next)
    if settings.auth_mode == "mock":
        state = secrets.token_urlsafe(16)
        request.session["mock_state"] = state
        params = {"code": "mock-code", "state": state}
        if mock_user:
            params["mock_user"] = mock_user[:40]
        return RedirectResponse(f"/api/auth/google/callback?{urlencode(params)}", status_code=302)
    oauth = request.app.state.oauth
    if oauth is None:
        raise ApiError(503, "auth_unconfigured", "Google sign-in isn't configured on this server.")
    return await oauth.google.authorize_redirect(request, _callback_url(request), prompt="select_account")


@router.get("/api/auth/google/callback", name="google_callback")
async def google_callback(request: Request, identity: Identity = Depends(get_identity)):
    state = request.app.state
    settings = state.settings
    target = safe_next(request.session.get("next"))
    if request.query_params.get("error"):
        request.session.clear()
        return RedirectResponse(with_param(target, "auth_error", "cancelled"), status_code=302)

    if settings.auth_mode == "mock":
        expected = request.session.get("mock_state")
        if not expected or request.query_params.get("state") != expected:
            request.session.clear()
            return RedirectResponse(with_param(target, "auth_error", "state"), status_code=302)
        profile = mock_profile(request.query_params.get("mock_user"))
    else:
        from authlib.integrations.starlette_client import OAuthError

        oauth = state.oauth
        if oauth is None:
            raise ApiError(503, "auth_unconfigured", "Google sign-in isn't configured on this server.")
        try:
            token = await oauth.google.authorize_access_token(request)
        except OAuthError as exc:
            log.warning("Google sign-in failed: %s", exc.error)
            request.session.clear()
            return RedirectResponse(with_param(target, "auth_error", "failed"), status_code=302)
        profile = token.get("userinfo") or {}
        if not profile.get("sub"):
            request.session.clear()
            return RedirectResponse(with_param(target, "auth_error", "failed"), status_code=302)
    request.session.clear()

    def save() -> int:
        with state.session_factory() as db:
            user = upsert_user(db, sub=str(profile["sub"]), email=profile.get("email"),
                               name=profile.get("name"), avatar_url=profile.get("picture"))
            claim_visitor_data(db, user.id, identity.client_hash)
            db.commit()
            return user.id

    user_id = await run_in_threadpool(save)
    response = RedirectResponse(with_param(target, "signed_in", "1"), status_code=302)
    set_session_cookie(response, user_id, state.keys, settings)
    return response


@router.post("/api/auth/logout")
async def logout(request: Request):
    response = JSONResponse({"signed_in": False})
    clear_session_cookie(response, request.app.state.settings)
    return response
