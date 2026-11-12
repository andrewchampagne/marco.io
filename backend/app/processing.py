"""Deterministic post-processing of a map payload (no LLM): validate, clean, fill N/A, summarize.

Section 5 of the spec: drop unknown ISO codes, coerce numerics, dedupe, reject NaN and invalid
negatives, then give every canonical country a row (value None = N/A) and compute stats.
"""

from __future__ import annotations

import statistics
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import ValidationError

from .countries import CountryIndex
from .llm.contract import MapMeta, MapPayload, Row

CATEGORICAL_REASON = (
    "This question asks for categories rather than numbers, and categorical maps aren't supported yet."
)


class PayloadError(ValueError):
    """The payload isn't a map result at all (not an object, or no usable meta)."""


@dataclass
class CleanRow:
    iso3: str
    value: float
    confidence: str
    note: str | None


@dataclass
class Cleaned:
    meta: MapMeta
    rows: list[CleanRow]
    status: Literal["ok", "unmappable", "empty"]
    dropped: dict[str, int] = field(default_factory=dict)

    @property
    def values(self) -> dict[str, float]:
        return {r.iso3: r.value for r in self.rows}


def clean_payload(payload: Any, countries: CountryIndex, allowed: frozenset[str] | None = None) -> Cleaned:
    """`allowed`: the focus region's countries; rows for any other country are dropped ("outside_region")."""
    if not isinstance(payload, dict):
        raise PayloadError("map payload must be a JSON object")
    try:
        parsed = MapPayload.model_validate(payload)
    except ValidationError as exc:
        raise PayloadError("map payload has no valid meta") from exc
    meta = parsed.meta

    if meta.status == "unmappable":
        return Cleaned(meta, [], "unmappable")
    if meta.value_type == "categorical":
        meta = meta.model_copy(update={"status": "unmappable", "reason": CATEGORICAL_REASON})
        return Cleaned(meta, [], "unmappable")

    rows: list[CleanRow] = []
    dropped: Counter[str] = Counter()
    seen: set[str] = set()
    for raw in parsed.rows:
        try:
            row = Row.from_list(raw)
        except ValidationError as exc:
            fields = {str(err["loc"][0]) for err in exc.errors() if err.get("loc")}
            dropped["invalid_value" if "value" in fields else "malformed"] += 1
            continue
        except ValueError:
            dropped["malformed"] += 1
            continue
        code = countries.normalize_code(row.iso3)
        if code is None:
            dropped["unknown_iso"] += 1
            continue
        if allowed is not None and code not in allowed:
            dropped["outside_region"] += 1
            continue
        if code in seen:
            dropped["duplicate"] += 1
            continue
        if row.value < 0 and not meta.allows_negative:
            dropped["negative"] += 1
            continue
        seen.add(code)
        rows.append(CleanRow(code, row.value, row.confidence, row.note))

    return Cleaned(meta, rows, "ok" if rows else "empty", dict(dropped))


def fill_all(rows: list[CleanRow], countries: CountryIndex) -> list[list[Any]]:
    """Every canonical country, in canonical order: [iso3, value|None, confidence|None, note|None]."""
    by_code = {r.iso3: r for r in rows}
    out: list[list[Any]] = []
    for country in countries.countries:
        row = by_code.get(country.iso3)
        out.append([country.iso3, row.value, row.confidence, row.note] if row else [country.iso3, None, None, None])
    return out


def compute_stats(values: list[float], total: int) -> dict[str, Any]:
    if not values:
        return {"count": 0, "na_count": total, "zero_count": 0, "total": total, "min": None, "max": None,
                "median": None, "mean": None}
    return {
        "count": len(values),
        "na_count": total - len(values),
        "zero_count": sum(1 for v in values if v == 0),
        "total": total,
        "min": min(values),
        "max": max(values),
        "median": statistics.median(values),
        "mean": statistics.fmean(values),
    }
