"""POST /api/maps (SSE), GET /api/maps/{slug}, POST /api/maps/{slug}/rebin, POST /api/key/validate."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from ..binning import MAX_CLASSES, METHODS, MIN_CLASSES
from ..errors import ApiError
from ..identity import Identity, get_identity
from ..llm.client import LLMError
from ..llm.keys import SHAPE_MESSAGE, key_shape_ok, read_key, validate_key
from ..models import Map
from ..pipeline import plan_request, sanitize_query, stream_map
from ..serialize import render_map, render_rebin

router = APIRouter()


class CreateMapRequest(BaseModel):
    query: str = Field(..., max_length=2000)
    region: str | None = Field(None, max_length=32)  # a regions.json id; omitted means the whole world


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
    query = sanitize_query(body.query, state.settings.max_query_chars)
    region = state.regions.get(body.region)
    key = read_key(request)
    if key is not None and not key_shape_ok(key.key):
        raise ApiError(400, "invalid_key", SHAPE_MESSAGE)
    lock_keys = identity.lock_keys()
    if not state.inflight.acquire(lock_keys):
        raise ApiError(409, "in_flight", "A map is already being generated. Wait for it to finish.")
    try:
        plan = await run_in_threadpool(plan_request, state, query, key is not None, region)
    except BaseException:
        state.inflight.release(lock_keys)
        raise
    return StreamingResponse(
        stream_map(state, plan, identity, key, lock_keys),
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
    """New method/classes on the stored values: no AI call."""
    _check_bins(body.method, body.classes)
    return render_rebin(_load(request, slug), request.app.state.countries, body.method, body.classes)


@router.post("/api/key/validate")
async def validate(request: Request):
    """Checks the key in X-OpenAI-Key. The key is never stored or logged."""
    settings = request.app.state.settings
    key = read_key(request)
    if key is None:
        raise ApiError(400, "missing_key", "Send the key in the X-OpenAI-Key header.")
    try:
        result = await validate_key(key.key, settings)
    except LLMError as exc:
        raise ApiError(502, exc.code, exc.message) from None
    finally:
        key = None  # nothing below may reference it
    return {"valid": result.valid, "code": result.code, "message": result.message, "model": settings.openai_model_id}
