"""POST /api/maps (SSE), GET /api/maps/{slug}, POST /api/maps/{slug}/rebin."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from ..binning import MAX_CLASSES, METHODS, MIN_CLASSES
from ..byok import read_byok
from ..errors import ApiError
from ..identity import Identity, get_identity
from ..llm.keys import key_shape_ok, shape_message
from ..models import Map
from ..pipeline import plan_request, sanitize_query, stream_map
from ..serialize import render_map, render_rebin

router = APIRouter()


class CreateMapRequest(BaseModel):
    query: str = Field(..., max_length=2000)


class RebinRequest(BaseModel):
    method: str | None = None
    classes: int | None = None


def _check_bins(method: str | None, classes: int | None) -> None:
    if method is not None and method not in METHODS:
        raise ApiError(400, "invalid_method", f"Binning method must be one of: {', '.join(METHODS)}.")
    if classes is not None and not MIN_CLASSES <= classes <= MAX_CLASSES:
        raise ApiError(400, "invalid_classes", f"Classes must be between {MIN_CLASSES} and {MAX_CLASSES}.")


@router.post("/api/maps")
async def create_map(body: CreateMapRequest, request: Request, identity: Identity = Depends(get_identity)):
    state = request.app.state
    settings = state.settings
    query = sanitize_query(body.query, settings.max_query_chars)
    byok = read_byok(request)
    if byok is not None:
        if not identity.signed_in:
            raise ApiError(403, "signin_required", "Sign in with Google to use your own API key.")
        if not settings.byok_enabled:
            raise ApiError(403, "byok_disabled", "Using your own API key is turned off on this server.")
        if not key_shape_ok(byok.key, byok.provider):
            raise ApiError(400, "invalid_key", shape_message(byok.provider))
    lock_keys = identity.lock_keys()
    if not state.inflight.acquire(lock_keys):
        raise ApiError(409, "in_flight", "A map is already being generated. Wait for it to finish.")
    try:
        plan = await run_in_threadpool(plan_request, state, query, identity, byok is not None)
    except BaseException:
        state.inflight.release(lock_keys)
        raise
    return StreamingResponse(
        stream_map(state, plan, identity, byok, lock_keys),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _load(request: Request, slug: str) -> Map:
    with request.app.state.session_factory() as db:
        m = db.scalar(select(Map).where(Map.slug == slug))
    if m is None:
        raise ApiError(404, "map_not_found", "That map doesn't exist (it may have been deleted).")
    return m


@router.get("/api/maps/{slug}")
def get_map(slug: str, request: Request, method: str | None = None, classes: int | None = None):
    _check_bins(method, classes)
    return render_map(_load(request, slug), request.app.state.countries, cached=True, method=method, classes=classes)


@router.post("/api/maps/{slug}/rebin")
def rebin(slug: str, body: RebinRequest, request: Request):
    """New method/classes on the stored values: no LLM call, no quota."""
    _check_bins(body.method, body.classes)
    return render_rebin(_load(request, slug), request.app.state.countries, body.method, body.classes)
