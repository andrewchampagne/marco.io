"""The LLM output contract: the JSON schema the model must follow, and Pydantic models that validate it.

It is sent as an OpenAI strict Structured Outputs schema (`text.format` json_schema), so every object is
closed (`additionalProperties: false`), every property is required, and the root is a plain object.

Rows are compact positional arrays, `[iso3, value, confidence, note?]`. Structured outputs can't express
tuple positions, so the schema says "array of string|number|null" and `Row.from_list` enforces positions.
Every property is required, and `meta` precedes `rows`, so the model always emits `meta` first. That
lets a response cut off at `max_tokens` be salvaged up to the last complete row.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator

CONTRACT_VERSION = 1

STATUSES = ("ok", "unmappable")
VALUE_TYPES = ("count", "rate", "percent", "index", "currency", "categorical")
HIGHER_IS = ("worse", "better", "neutral")
SCALES = ("linear", "log", "quantile")
PALETTE_IDS = ("verdant", "viridis", "inferno", "ice", "neon", "mono", "cividis")
CONFIDENCE = ("h", "m", "l")

MAX_CAVEATS = 3
MAX_SUGGESTIONS = 3
MAX_NOTE_CHARS = 80


def _string(desc: str) -> dict:
    return {"type": "string", "description": desc}


def _enum(values: Sequence[str], desc: str) -> dict:
    return {"type": "string", "enum": list(values), "description": desc}


META_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "status": _enum(STATUSES, "ok, or unmappable if the question is not a per-country measure"),
        "reason": _string("Empty when ok; otherwise one short sentence explaining why"),
        "title": _string("Short map title"),
        "metric_label": _string("What the number measures"),
        "unit": _string("The single unit every value is expressed in"),
        "time_scope": _string("Period the values describe, e.g. 1914-1918 or 2023"),
        "value_type": _enum(VALUE_TYPES, "Kind of quantity"),
        "higher_is": _enum(HIGHER_IS, "Whether larger values are worse, better or neutral"),
        "allows_negative": {"type": "boolean", "description": "True only if the metric can be negative"},
        "suggested_scale": _enum(SCALES, "Binning suggestion"),
        "suggested_palette": _enum(PALETTE_IDS, "Palette suggestion"),
        "recency_sensitive": {"type": "boolean", "description": "True if values change year to year"},
        "caveats": {"type": "array", "items": {"type": "string"}, "description": "Up to 3 short caveats"},
        "suggestions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Empty when ok; otherwise up to 3 mappable rephrasings",
        },
    },
    "required": [
        "status", "reason", "title", "metric_label", "unit", "time_scope", "value_type", "higher_is",
        "allows_negative", "suggested_scale", "suggested_palette", "recency_sensitive", "caveats",
        "suggestions",
    ],
    "additionalProperties": False,
}

ROWS_SCHEMA: dict[str, Any] = {
    "type": "array",
    "description": "One row per country with data: [ISO3, value, confidence, optional note]",
    "items": {
        "type": "array",
        "items": {"anyOf": [{"type": "string"}, {"type": "number"}, {"type": "null"}]},
    },
}

MAP_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"meta": META_SCHEMA, "rows": ROWS_SCHEMA},
    "required": ["meta", "rows"],
    "additionalProperties": False,
}

_DEFAULTS = {
    "status": ("ok", STATUSES),
    "value_type": ("count", VALUE_TYPES),
    "higher_is": ("neutral", HIGHER_IS),
    "suggested_scale": ("quantile", SCALES),
    "suggested_palette": ("verdant", PALETTE_IDS),
}
_WS = re.compile(r"\s+")


def clean_text(value: Any, limit: int) -> str:
    """Collapse whitespace, strip control characters, and clip to `limit` characters."""
    if value is None:
        return ""
    text = _WS.sub(" ", "".join(ch for ch in str(value) if ch.isprintable() or ch == " ")).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


class MapMeta(BaseModel):
    """Map metadata. Lenient: unknown enum values fall back to safe defaults instead of failing."""

    model_config = ConfigDict(extra="ignore")

    status: Literal["ok", "unmappable"] = "ok"
    reason: str = ""
    title: str = ""
    metric_label: str = ""
    unit: str = ""
    time_scope: str = ""
    value_type: Literal["count", "rate", "percent", "index", "currency", "categorical"] = "count"
    higher_is: Literal["worse", "better", "neutral"] = "neutral"
    allows_negative: bool = False
    suggested_scale: Literal["linear", "log", "quantile"] = "quantile"
    suggested_palette: str = "verdant"
    recency_sensitive: bool = False
    caveats: list[str] = []
    suggestions: list[str] = []

    @field_validator("status", "value_type", "higher_is", "suggested_scale", "suggested_palette", mode="before")
    @classmethod
    def _known_or_default(cls, value: Any, info) -> str:
        default, allowed = _DEFAULTS[info.field_name]
        text = str(value).strip().lower() if value is not None else ""
        return text if text in allowed else default

    @field_validator("reason", "title", "metric_label", "unit", "time_scope", mode="before")
    @classmethod
    def _short_text(cls, value: Any, info) -> str:
        limit = {"reason": 160, "title": 90, "metric_label": 120, "unit": 60, "time_scope": 60}[info.field_name]
        return clean_text(value, limit)

    @field_validator("allows_negative", "recency_sensitive", mode="before")
    @classmethod
    def _bool(cls, value: Any) -> bool:
        if isinstance(value, str):
            return value.strip().lower() in {"true", "yes", "1"}
        return bool(value)

    @field_validator("caveats", "suggestions", mode="before")
    @classmethod
    def _string_list(cls, value: Any, info) -> list[str]:
        if not isinstance(value, list):
            return []
        limit = 160 if info.field_name == "caveats" else 120
        cap = MAX_CAVEATS if info.field_name == "caveats" else MAX_SUGGESTIONS
        items = [clean_text(v, limit) for v in value if isinstance(v, str)]
        return [i for i in items if i][:cap]


_CONFIDENCE_WORDS = {"high": "h", "medium": "m", "med": "m", "moderate": "m", "low": "l"}
_NUMBER_JUNK = re.compile(r"[,_\s  ]")


class Row(BaseModel):
    """One validated country row. Positional input: [iso3, value, confidence, note?]."""

    iso3: str
    value: float
    confidence: Literal["h", "m", "l"] = "l"
    note: str | None = None

    @classmethod
    def from_list(cls, raw: Any) -> "Row":
        if not isinstance(raw, (list, tuple)) or len(raw) < 2:
            raise ValueError("row must be [iso3, value, confidence, note?]")
        return cls(
            iso3=raw[0] if isinstance(raw[0], str) else "",
            value=raw[1],
            confidence=raw[2] if len(raw) > 2 else None,
            note=raw[3] if len(raw) > 3 else None,
        )

    @field_validator("value", mode="before")
    @classmethod
    def _coerce_number(cls, value: Any) -> float:
        if isinstance(value, bool) or value is None:
            raise ValueError("value must be a number")
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            text = _NUMBER_JUNK.sub("", value).rstrip("%")
            return float(text)  # ValueError for words, ranges, units
        raise ValueError("value must be a number")

    @field_validator("value")
    @classmethod
    def _finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("value must be finite")
        return value

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidence(cls, value: Any) -> str:
        text = str(value).strip().lower() if value is not None else ""
        text = _CONFIDENCE_WORDS.get(text, text)
        return text if text in CONFIDENCE else "l"

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        return clean_text(value, MAX_NOTE_CHARS) or None


class MapPayload(BaseModel):
    """Top-level shape. Rows stay raw here; `processing.clean_payload` validates them one by one."""

    model_config = ConfigDict(extra="ignore")

    meta: MapMeta
    rows: list[Any] = []
