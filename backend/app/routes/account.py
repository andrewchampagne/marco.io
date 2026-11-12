"""Usage, BYOK key validation, account, history and data export."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import delete, or_, select
from starlette.concurrency import run_in_threadpool

from ..byok import read_byok
from ..db import utcnow
from ..errors import ApiError
from ..identity import Identity, clear_session_cookie, get_identity
from ..llm.client import LLMError
from ..llm.keys import key_shape_ok, model_for, validate_key
from ..models import HistoryEntry, Map, UsageEvent, User
from ..quota import budget_exhausted, quota_status
from ..serialize import iso, usage_payload

router = APIRouter()
HISTORY_LIMIT = 50


def _owner_filter(model, identity: Identity):
    """Rows belonging to this account, or, signed out, to this browser's anonymous visitor."""
    if identity.user is not None:
        return model.user_id == identity.user.id
    return (model.client_hash == identity.client_hash) & model.user_id.is_(None)


@router.get("/api/usage")
def usage(request: Request, identity: Identity = Depends(get_identity)):
    settings = request.app.state.settings
    key = read_byok(request)
    byok = bool(identity.signed_in and settings.byok_enabled and key and key_shape_ok(key.key, key.provider))
    with request.app.state.session_factory() as db:
        qs = quota_status(db, settings, client_hash=identity.client_hash, ip_hash=identity.ip_hash,
                          user_id=identity.user_id)
        return usage_payload(qs, identity, settings, byok=byok, budget_exhausted=budget_exhausted(db, settings))


@router.post("/api/key/validate")
async def validate(request: Request, identity: Identity = Depends(get_identity)):
    settings = request.app.state.settings
    if not identity.signed_in:
        raise ApiError(403, "signin_required", "Sign in with Google before adding an API key.")
    if not settings.byok_enabled:
        raise ApiError(403, "byok_disabled", "Using your own API key is turned off on this server.")
    byok = read_byok(request)
    if byok is None or not byok.key:
        raise ApiError(400, "missing_key", "Send the key in the X-OpenAI-Key or X-Anthropic-Key header.")
    provider = byok.provider
    try:
        result = await validate_key(byok.key, provider, settings)
    except LLMError as exc:
        raise ApiError(502, exc.code, exc.message) from None
    finally:
        byok = None  # nothing below may reference the key
    return {"valid": result.valid, "code": result.code, "message": result.message, "provider": provider,
            "model": model_for(provider, settings)}


@router.get("/api/me")
def me(identity: Identity = Depends(get_identity)):
    user = identity.user
    if user is None:
        return {"signed_in": False, "name": None, "email": None, "avatar_url": None}
    return {"signed_in": True, "name": user.name, "email": user.email, "avatar_url": user.avatar_url}


@router.delete("/api/me")
def delete_me(request: Request, identity: Identity = Depends(get_identity)):
    """Delete the account and everything linked to it: maps, history, usage rows."""
    if identity.user is None:
        raise ApiError(401, "not_signed_in", "You're not signed in.")
    uid = identity.user.id
    with request.app.state.session_factory() as db:
        counts = {
            "history": db.execute(delete(HistoryEntry).where(HistoryEntry.user_id == uid)).rowcount,
            "usage": db.execute(delete(UsageEvent).where(UsageEvent.user_id == uid)).rowcount,
            "maps": db.execute(delete(Map).where(Map.user_id == uid)).rowcount,
        }
        db.execute(delete(User).where(User.id == uid))
        db.commit()
    response = JSONResponse({"deleted": True, **counts})
    clear_session_cookie(response, request.app.state.settings)
    return response


@router.get("/api/history")
def history(request: Request, identity: Identity = Depends(get_identity)):
    with request.app.state.session_factory() as db:
        rows = db.execute(
            select(HistoryEntry, Map)
            .join(Map, Map.id == HistoryEntry.map_id)
            .where(_owner_filter(HistoryEntry, identity))
            .order_by(HistoryEntry.created_at.desc())
            .limit(HISTORY_LIMIT)
        ).all()
    return {"items": [
        {"slug": m.slug, "query": h.query, "title": (m.meta or {}).get("title") or h.query, "status": m.status,
         "created_at": iso(h.created_at)}
        for h, m in rows
    ]}


@router.delete("/api/history")
def clear_history(request: Request, identity: Identity = Depends(get_identity)):
    """Clears what's listed in the history drawer. Usage events stay, so this never resets the quota."""
    with request.app.state.session_factory() as db:
        deleted = db.execute(delete(HistoryEntry).where(_owner_filter(HistoryEntry, identity))).rowcount
        db.commit()
    return {"deleted": deleted}


@router.get("/api/me/export")
def export(request: Request, identity: Identity = Depends(get_identity)):
    """Everything stored about this account (or, signed out, this browser), as a JSON download."""
    with request.app.state.session_factory() as db:
        user = identity.user
        history_rows = db.execute(
            select(HistoryEntry, Map).join(Map, Map.id == HistoryEntry.map_id)
            .where(_owner_filter(HistoryEntry, identity)).order_by(HistoryEntry.created_at)
        ).all()
        maps = db.scalars(select(Map).where(_owner_filter(Map, identity)).order_by(Map.created_at)).all()
        events = db.scalars(select(UsageEvent).where(_owner_filter(UsageEvent, identity)).order_by(UsageEvent.created_at)).all()
    body = {
        "exported_at": iso(utcnow()),
        "account": None if user is None else {
            "name": user.name, "email": user.email, "avatar_url": user.avatar_url,
            "created_at": iso(user.created_at), "last_login": iso(user.last_login),
        },
        "history": [{"query": h.query, "map": m.slug, "created_at": iso(h.created_at)} for h, m in history_rows],
        "maps_created": [
            {"slug": m.slug, "query": m.raw_query, "status": m.status, "title": (m.meta or {}).get("title"),
             "source": m.source, "model": m.model, "created_at": iso(m.created_at)}
            for m in maps
        ],
        "usage": [
            {"created_at": iso(e.created_at), "status": e.status, "source": e.source, "cache_hit": e.cache_hit,
             "own_key": e.byok, "counted_against_free_quota": e.counted, "tokens_in": e.tokens_in,
             "tokens_out": e.tokens_out, "estimated_cost_usd": round(e.cost_est, 6)}
            for e in events
        ],
        "not_stored": [
            "Your Anthropic API key (it stays in your browser)",
            "Your IP address (only a salted one-way hash is kept, for the free-tier limit)",
        ],
    }
    return Response(
        json.dumps(body, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="terrachrome-data.json"'},
    )
