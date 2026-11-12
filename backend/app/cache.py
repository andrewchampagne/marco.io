"""Tier 0: the SQL cache. Questions are normalized so trivially different phrasings share one entry.

`find_cached(query)` is the single lookup hook. Today it's an exact match on the normalized-question hash.
`semantic_lookup` is the stub where an embedding-based semantic cache can plug in later (v2): embed the
normalized question, find the nearest cached map within a similarity threshold, and return it if its
contract version and TTL are still valid. No vector store exists in v1, by design.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re
import unicodedata

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .db import as_utc, utcnow
from .llm.contract import CONTRACT_VERSION
from .models import Map

NORMALIZE_VERSION = 1

_PHRASES = [  # canonical spellings, applied before filler stripping
    (r"\b(ww ?1|wwi|world war (i|1|one)|first world war|the great war|great war)\b", "world war 1"),
    (r"\b(ww ?2|wwii|world war (ii|2|two)|second world war)\b", "world war 2"),
    (r"\bco₂\b", "co2"),
    (r"\b(u\.?s\.?a?|united states of america)\b", "united states"),
    (r"\b(u\.?k\.?)\b", "united kingdom"),
    (r"\bpercentage\b|\bpct\b", "percent"),
]
_LEADING = (
    "please ", "can you ", "could you ", "show me ", "show ", "give me ", "display ", "plot ",
    "a map of ", "map of ", "map ", "what is the ", "what are the ", "what is ", "what are ", "whats the ",
    "what s the ", "tell me ", "i want to see ", "i want ",
)
_TRAILING = (
    " please", " by country", " per country", " for each country", " for every country", " of each country",
    " in each country", " across countries", " around the world", " worldwide", " by nation", " map",
    " on a map", " by countries",
)
_ARTICLES = re.compile(r"\b(the|a|an)\b")
_NON_WORD = re.compile(r"[^\w\s]")
_WS = re.compile(r"\s+")


def normalize_query(query: str) -> str:
    text = unicodedata.normalize("NFKC", query).casefold()
    text = text.replace("&", " and ").replace("%", " percent ")
    for pattern, repl in _PHRASES:
        text = re.sub(pattern, repl, text)
    text = _NON_WORD.sub(" ", text)
    text = _WS.sub(" ", text).strip()
    changed = True
    while changed:
        changed = False
        for prefix in _LEADING:
            if text.startswith(prefix) and len(text) > len(prefix):
                text, changed = text[len(prefix):].strip(), True
        for suffix in _TRAILING:
            if text.endswith(suffix) and len(text) > len(suffix):
                text, changed = text[: -len(suffix)].strip(), True
    text = _ARTICLES.sub(" ", text)
    return _WS.sub(" ", text).strip()


def query_hash(normalized: str) -> str:
    return hashlib.sha256(f"v{NORMALIZE_VERSION}:{normalized}".encode()).hexdigest()


def expires_at(recency_sensitive: bool, *, ttl_days: int, recent_ttl_hours: int, now: dt.datetime | None = None) -> dt.datetime:
    now = now or utcnow()
    return now + (dt.timedelta(hours=recent_ttl_hours) if recency_sensitive else dt.timedelta(days=ttl_days))


def semantic_lookup(db: Session, normalized: str, *, now: dt.datetime) -> Map | None:
    """v2 hook: embedding-based nearest-neighbour lookup over cached maps. Intentionally not built in v1."""
    return None


def find_cached(
    db: Session, query: str, *, now: dt.datetime | None = None, model: str | None = None, mock: bool | None = None,
    region: str = "world",
) -> Map | None:
    """The newest unexpired map for this question and focus region. With `model`, AI maps must come from that
    model (data-source maps, which have no model, always match), so changing models regenerates answers. With
    `mock`, maps must match the mode, so fixture data never answers a live request (and vice versa)."""
    now = now or utcnow()
    normalized = normalize_query(query)
    conditions = [Map.query_hash == query_hash(normalized), Map.contract_version == CONTRACT_VERSION,
                  Map.region == region]
    if model is not None:
        conditions.append(or_(Map.model == model, Map.model.is_(None)))
    if mock is not None:
        conditions.append(Map.mock == mock)
    candidate = db.scalars(
        select(Map)
        .where(*conditions)
        .order_by(Map.created_at.desc())
        .limit(1)
    ).first()
    if candidate is not None and as_utc(candidate.expires_at) > now:
        return candidate
    return semantic_lookup(db, normalized, now=now)
