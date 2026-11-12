"""POST /api/maps: the tiered retrieval pipeline, streamed as server-sent events.

Pre-flight checks run before the stream opens, so they return plain HTTP errors (400/403/409/429/503):
query validation, the BYOK sign-in rule, the in-flight lock, the cache lookup, and quota/budget.
Then the stream emits `status` and `progress` events and ends with exactly one `result` or `error`.

    Tier 0  SQL cache (free, uncounted)
    Tier C  World Bank connector, if the question matches its catalog (free, uncounted)
    Tier 1  strategy A: one LLM call, no tools               (free tier: counted)
    Tier 2  strategy B: + web search, the model decides       (BYOK, or ADMIN_WEB_SEARCH)
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import string
import unicodedata
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .cache import expires_at, find_cached, normalize_query, query_hash
from .config import Settings
from .datasources.base import DataSource, DataSourceError, SourceMatch
from .errors import ApiError
from .identity import Identity
from .llm.client import LLMError, LLMResult, Usage
from .llm.contract import CONTRACT_VERSION
from .models import HistoryEntry, Map, UsageEvent
from .processing import Cleaned, PayloadError, clean_payload
from .quota import budget_exhausted, budget_resets_at, quota_status
from .serialize import iso, render_map, usage_payload

log = logging.getLogger(__name__)

HEARTBEAT_S = 10.0
SALVAGE_CAVEAT = "The AI's answer was cut off, so some countries may be missing"
_WS = re.compile(r"\s+")
_SLUG_ALPHABET = string.ascii_letters + string.digits


def sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n".encode()


def sanitize_query(raw: str, max_chars: int) -> str:
    """Strip control/format characters and collapse whitespace; reject empty or over-long questions."""
    text = "".join(" " if unicodedata.category(ch).startswith("C") else ch for ch in raw)
    text = _WS.sub(" ", text).strip()
    if not text:
        raise ApiError(400, "empty_query", "Type a question to map.")
    if len(text) > max_chars:
        raise ApiError(400, "query_too_long", f"Questions are limited to {max_chars} characters.", max_chars=max_chars)
    return text


@dataclass
class Plan:
    query: str
    normalized: str
    qhash: str
    byok: bool
    web_search: bool
    cached_map_id: int | None = None
    match: SourceMatch | None = None
    source: DataSource | None = None


@dataclass
class Generated:
    cleaned: Cleaned
    source: str  # llm | llm+web | worldbank
    strategy: str
    model: str | None = None
    source_info: dict[str, Any] | None = None
    usage: Usage = field(default_factory=Usage)
    cost: float = 0.0
    latency_ms: int = 0


def free_tier_block(db: Session, settings: Settings, identity: Identity) -> ApiError | None:
    qs = quota_status(db, settings, client_hash=identity.client_hash, ip_hash=identity.ip_hash, user_id=identity.user_id)
    if qs.exhausted:
        return ApiError(
            429, "quota_exceeded", f"You've used your {qs.limit} free maps for now.",
            reset_at=iso(qs.reset_at), signed_in=identity.signed_in, used=qs.used, limit=qs.limit,
            byok_available=settings.byok_enabled,
        )
    if budget_exhausted(db, settings):
        return ApiError(
            503, "budget_exhausted",
            "Free maps are paused for today because the daily budget is used up. "
            "Add your own API key to keep going, or try again after midnight UTC.",
            reset_at=iso(budget_resets_at()), signed_in=identity.signed_in,
        )
    return None


def plan_request(state, query: str, identity: Identity, byok: bool) -> Plan:
    settings: Settings = state.settings
    normalized = normalize_query(query)
    plan = Plan(query=query, normalized=normalized, qhash=query_hash(normalized), byok=byok,
                web_search=byok or settings.admin_web_search)
    with state.session_factory() as db:
        cached = find_cached(db, query)
        if cached is not None:
            plan.cached_map_id = cached.id
            return plan
        if settings.datasources_enabled:
            for source in state.datasources:
                match = source.match(query)
                if match is not None:
                    plan.match, plan.source = match, source
                    break
        if plan.match is None and not byok:
            blocked = free_tier_block(db, settings, identity)
            if blocked is not None:
                raise blocked
    return plan


def _new_slug(db: Session) -> str:
    for _ in range(10):
        slug = "".join(secrets.choice(_SLUG_ALPHABET) for _ in range(8))
        if db.scalar(select(Map.id).where(Map.slug == slug)) is None:
            return slug
    raise RuntimeError("could not allocate a unique slug")


def _usage(db: Session, state, identity: Identity, byok: bool) -> dict:
    settings = state.settings
    qs = quota_status(db, settings, client_hash=identity.client_hash, ip_hash=identity.ip_hash, user_id=identity.user_id)
    return usage_payload(qs, identity, settings, byok=byok, budget_exhausted=budget_exhausted(db, settings))


def serve_cached(state, plan: Plan, identity: Identity) -> dict:
    with state.session_factory() as db:
        m = db.get(Map, plan.cached_map_id)
        m.hits = (m.hits or 0) + 1
        db.add(HistoryEntry(map_id=m.id, user_id=identity.user_id, client_hash=identity.client_hash, query=plan.query))
        db.add(UsageEvent(client_hash=identity.client_hash, ip_hash=identity.ip_hash, user_id=identity.user_id,
                          status=m.status, source="cache", cache_hit=True, byok=plan.byok, counted=False, map_id=m.id))
        db.commit()
        return {**render_map(m, state.countries, cached=True), "usage": _usage(db, state, identity, plan.byok)}


def persist(state, plan: Plan, identity: Identity, gen: Generated) -> dict:
    settings: Settings = state.settings
    cleaned = gen.cleaned
    meta = cleaned.meta.model_dump()
    counted = not plan.byok and gen.source in ("llm", "llm+web") and cleaned.status in ("ok", "unmappable")
    with state.session_factory() as db:
        m = Map(
            slug=_new_slug(db), raw_query=plan.query, normalized_query=plan.normalized[:400], query_hash=plan.qhash,
            contract_version=CONTRACT_VERSION, status=cleaned.status, meta=meta,
            rows=[[r.iso3, r.value, r.confidence, r.note] for r in cleaned.rows],
            source=gen.source, source_info=gen.source_info, model=gen.model, strategy=gen.strategy,
            mock=settings.llm_mode == "mock" and gen.source != "worldbank",
            tokens_in=gen.usage.input_tokens, tokens_out=gen.usage.output_tokens,
            cache_read_tokens=gen.usage.cache_read_tokens, cache_write_tokens=gen.usage.cache_write_tokens,
            web_searches=gen.usage.web_searches, cost_est=gen.cost, latency_ms=gen.latency_ms,
            user_id=identity.user_id, client_hash=identity.client_hash,
            expires_at=expires_at(cleaned.meta.recency_sensitive, ttl_days=settings.cache_ttl_days,
                                  recent_ttl_hours=settings.recent_cache_ttl_hours),
        )
        db.add(m)
        db.flush()
        db.add(HistoryEntry(map_id=m.id, user_id=identity.user_id, client_hash=identity.client_hash, query=plan.query))
        db.add(UsageEvent(
            client_hash=identity.client_hash, ip_hash=identity.ip_hash, user_id=identity.user_id,
            status=cleaned.status, source=gen.source, cache_hit=False, byok=plan.byok, counted=counted,
            tokens_in=gen.usage.input_tokens, tokens_out=gen.usage.output_tokens,
            cache_read_tokens=gen.usage.cache_read_tokens, cache_write_tokens=gen.usage.cache_write_tokens,
            cost_est=gen.cost, map_id=m.id,
        ))
        db.commit()
        return {**render_map(m, state.countries, cached=False), "usage": _usage(db, state, identity, plan.byok)}


def record_failure(state, identity: Identity, *, byok: bool, code: str, source: str = "llm",
                   usage: Usage | None = None, cost: float = 0.0, status: str = "error") -> None:
    """Failures never count against the quota, but any real spend still counts toward the budget."""
    usage = usage or Usage()
    with state.session_factory() as db:
        db.add(UsageEvent(
            client_hash=identity.client_hash, ip_hash=identity.ip_hash, user_id=identity.user_id, status=status,
            source=source, cache_hit=False, byok=byok, counted=False, error_code=code[:40],
            tokens_in=usage.input_tokens, tokens_out=usage.output_tokens, cache_read_tokens=usage.cache_read_tokens,
            cache_write_tokens=usage.cache_write_tokens, cost_est=cost,
        ))
        db.commit()


async def run_with_progress(generator, query: str, *, api_key: str | None, web_search: bool) -> AsyncIterator[tuple[str, Any]]:
    """Run one generation while relaying its row counter; yields ('progress', n), ('heartbeat', None),
    and finally ('result', LLMResult). If the client disconnects, the generation is cancelled."""
    queue: asyncio.Queue[int] = asyncio.Queue()

    async def on_progress(n: int) -> None:
        queue.put_nowait(n)

    task = asyncio.create_task(generator.generate(query, api_key=api_key, web_search=web_search, on_progress=on_progress))
    try:
        while not task.done():
            getter = asyncio.ensure_future(queue.get())
            done, _ = await asyncio.wait({task, getter}, timeout=HEARTBEAT_S, return_when=asyncio.FIRST_COMPLETED)
            if getter in done:
                yield "progress", getter.result()
            else:
                getter.cancel()
                if not done:
                    yield "heartbeat", None
        while not queue.empty():
            yield "progress", queue.get_nowait()
        yield "result", task.result()
    finally:
        if not task.done():
            task.cancel()


async def stream_map(state, plan: Plan, identity: Identity, api_key: str | None, lock_keys: list[str]) -> AsyncIterator[bytes]:
    countries = state.countries
    try:
        yield sse("status", {"stage": "interpreting", "message": "Interpreting your question"})
        if plan.cached_map_id is not None:
            yield sse("status", {"stage": "cache", "message": "Found a saved map"})
            yield sse("result", await run_in_threadpool(serve_cached, state, plan, identity))
            return

        gen: Generated | None = None
        if plan.match is not None and plan.source is not None:
            yield sse("status", {"stage": "gathering", "message": "Fetching World Bank data", "source": "worldbank"})
            try:
                src = await plan.source.fetch(plan.match)
                cleaned = clean_payload(src.payload, countries)
                if cleaned.status == "ok":
                    gen = Generated(cleaned, source="worldbank", strategy="C", source_info=src.source,
                                    latency_ms=src.latency_ms)
            except (DataSourceError, PayloadError) as exc:
                log.warning("Data source fell through to the LLM: %s", exc)
            if gen is None and not plan.byok:
                blocked = await run_in_threadpool(lambda: _check_free_tier(state, identity))
                if blocked is not None:
                    yield sse("error", {**blocked.body(), "status": blocked.status})
                    return

        if gen is None:
            yield sse("status", {"stage": "gathering", "message": "Gathering data"})
            result: LLMResult | None = None
            async for kind, value in run_with_progress(state.generator, plan.query, api_key=api_key, web_search=plan.web_search):
                if kind == "progress":
                    yield sse("progress", {"countries": value})
                elif kind == "heartbeat":
                    yield b": keep-alive\n\n"
                else:
                    result = value
            yield sse("status", {"stage": "building", "message": "Building map"})
            source = "llm+web" if result.usage.web_searches else "llm"
            try:
                cleaned = clean_payload(result.payload, countries)
            except PayloadError:
                await run_in_threadpool(record_failure, state, identity, byok=plan.byok, code="bad_output",
                                        source=source, usage=result.usage, cost=result.cost_usd)
                yield sse("error", {"code": "bad_output", "message": "The AI returned an unreadable result. Please try again.",
                                    "retryable": True})
                return
            if cleaned.status == "empty":
                await run_in_threadpool(record_failure, state, identity, byok=plan.byok, code="no_data", source=source,
                                        usage=result.usage, cost=result.cost_usd, status="empty")
                yield sse("error", {"code": "no_data", "message": "The AI didn't return usable data for any country.",
                                    "retryable": True})
                return
            if result.salvaged and len(cleaned.meta.caveats) < 3:
                cleaned.meta.caveats.append(SALVAGE_CAVEAT)
            gen = Generated(
                cleaned, source=source, strategy=result.strategy, model=result.model,
                source_info={"sources": result.sources} if result.sources else None,
                usage=result.usage, cost=result.cost_usd, latency_ms=result.latency_ms,
            )
        else:
            yield sse("status", {"stage": "building", "message": "Building map"})

        yield sse("result", await run_in_threadpool(persist, state, plan, identity, gen))
    except LLMError as exc:
        await run_in_threadpool(record_failure, state, identity, byok=plan.byok, code=exc.code)
        yield sse("error", {"code": exc.code, "message": exc.message, "retryable": exc.retryable})
    except Exception:  # noqa: BLE001 - the stream must always end with an event
        log.exception("Map generation failed")
        yield sse("error", {"code": "server_error", "message": "Something went wrong while building the map.",
                            "retryable": True})
    finally:
        state.inflight.release(lock_keys)


def _check_free_tier(state, identity: Identity) -> ApiError | None:
    with state.session_factory() as db:
        return free_tier_block(db, state.settings, identity)
