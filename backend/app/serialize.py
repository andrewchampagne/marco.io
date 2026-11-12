"""Map responses: rows for every canonical country with bin indices, legend, stats and provenance."""

from __future__ import annotations

import datetime as dt
from typing import Any

from .binning import DEFAULT_CLASSES, Binning, assign, compute_map_bins, legend, method_for_scale
from .countries import CountryIndex
from .db import as_utc
from .models import Map
from .processing import compute_stats
from .regions import load_regions


def iso(value: dt.datetime | None) -> str | None:
    value = as_utc(value)
    return value.isoformat().replace("+00:00", "Z") if value else None


def _binning_for(m: Map, method: str | None, classes: int | None) -> tuple[Binning, list[float]]:
    values = [r[1] for r in m.rows]
    method = method or method_for_scale((m.meta or {}).get("suggested_scale"))
    return compute_map_bins(values, method, classes), values


def bins_for(m: Map, countries: CountryIndex, binning: Binning) -> list[int | None]:
    by_code = {r[0]: r for r in m.rows}
    return [assign(by_code[c.iso3][1], binning) if c.iso3 in by_code else None for c in countries.countries]


def render_map(
    m: Map,
    countries: CountryIndex,
    *,
    cached: bool,
    method: str | None = None,
    classes: int | None = None,
) -> dict[str, Any]:
    meta = dict(m.meta or {})
    region = load_regions().resolve(m.region)
    out: dict[str, Any] = {
        "slug": m.slug,
        "query": m.raw_query,
        "status": m.status,
        "region": region.id,
        "meta": meta,
        "created_at": iso(m.created_at),
        "source": {"kind": m.source, "strategy": m.strategy, "model": m.model, "mock": m.mock, "info": m.source_info},
        "generation": {
            "tokens_in": m.tokens_in, "tokens_out": m.tokens_out, "cache_read": m.cache_read_tokens,
            "cache_write": m.cache_write_tokens, "web_searches": m.web_searches, "cost_usd": m.cost_est,
            "latency_ms": m.latency_ms,
        },
        "request": {
            "cached": cached,
            "tokens_in": 0 if cached else m.tokens_in + m.cache_read_tokens + m.cache_write_tokens,
            "tokens_out": 0 if cached else m.tokens_out,
            "cost_usd": 0.0 if cached else m.cost_est,
        },
    }
    if m.status != "ok" or not m.rows:
        return {**out, "rows": [], "stats": None, "binning": None, "legend": [], "defaults": None}
    binning, values = _binning_for(m, method, classes)
    by_code = {r[0]: r for r in m.rows}
    rows = []
    for country in countries.countries:
        r = by_code.get(country.iso3)
        rows.append([country.iso3, r[1], r[2], r[3], assign(r[1], binning)] if r else [country.iso3, None, None, None, None])
    return {
        **out,
        "rows": rows,
        "stats": compute_stats(values, len(region.members)),  # "no data" counts only the region's countries
        "binning": binning.to_dict(),
        "legend": legend(values, binning),
        "defaults": {
            "method": binning.requested_method,
            "classes": DEFAULT_CLASSES,
            "palette": meta.get("suggested_palette") or "verdant",
            "reverse": meta.get("higher_is") == "better",
        },
    }


def render_rebin(m: Map, countries: CountryIndex, method: str | None, classes: int | None) -> dict[str, Any]:
    binning, values = _binning_for(m, method, classes)
    return {"slug": m.slug, "binning": binning.to_dict(), "legend": legend(values, binning),
            "bins": bins_for(m, countries, binning)}
