"""This browser's history and data export. There are no accounts: data belongs to the visitor cookie."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import delete, select

from ..db import utcnow
from ..identity import Identity, get_identity
from ..models import HistoryEntry, Map, UsageEvent
from ..serialize import iso

router = APIRouter()
HISTORY_LIMIT = 50


def _mine(model, identity: Identity):
    return model.client_hash == identity.client_hash


@router.get("/api/history")
def history(request: Request, identity: Identity = Depends(get_identity)):
    with request.app.state.session_factory() as db:
        rows = db.execute(
            select(HistoryEntry, Map)
            .join(Map, Map.id == HistoryEntry.map_id)
            .where(_mine(HistoryEntry, identity))
            .order_by(HistoryEntry.created_at.desc())
            .limit(HISTORY_LIMIT)
        ).all()
    return {"items": [
        {"slug": m.slug, "query": h.query, "title": (m.meta or {}).get("title") or h.query, "status": m.status,
         "region": m.region or "world", "created_at": iso(h.created_at)}
        for h, m in rows
    ]}


@router.delete("/api/history")
def clear_history(request: Request, identity: Identity = Depends(get_identity)):
    """Clears what's listed in the history drawer."""
    with request.app.state.session_factory() as db:
        deleted = db.execute(delete(HistoryEntry).where(_mine(HistoryEntry, identity))).rowcount
        db.commit()
    return {"deleted": deleted}


@router.get("/api/export")
def export(request: Request, identity: Identity = Depends(get_identity)):
    """Everything stored about this browser, as a JSON download."""
    with request.app.state.session_factory() as db:
        history_rows = db.execute(
            select(HistoryEntry, Map).join(Map, Map.id == HistoryEntry.map_id)
            .where(_mine(HistoryEntry, identity)).order_by(HistoryEntry.created_at)
        ).all()
        maps = db.scalars(select(Map).where(_mine(Map, identity)).order_by(Map.created_at)).all()
        events = db.scalars(select(UsageEvent).where(_mine(UsageEvent, identity)).order_by(UsageEvent.created_at)).all()
    body = {
        "exported_at": iso(utcnow()),
        "history": [{"query": h.query, "map": m.slug, "created_at": iso(h.created_at)} for h, m in history_rows],
        "maps_created": [
            {"slug": m.slug, "query": m.raw_query, "status": m.status, "title": (m.meta or {}).get("title"),
             "source": m.source, "model": m.model, "created_at": iso(m.created_at)}
            for m in maps
        ],
        "usage": [
            {"created_at": iso(e.created_at), "status": e.status, "source": e.source, "cache_hit": e.cache_hit,
             "tokens_in": e.tokens_in, "tokens_out": e.tokens_out, "estimated_cost_usd": round(e.cost_est, 6)}
            for e in events
        ],
        "not_stored": [
            "Your OpenAI API key (it stays in your browser)",
            "Your IP address (only a salted one-way hash is kept, for rate limiting)",
        ],
    }
    return Response(
        json.dumps(body, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="marco-data.json"'},
    )
