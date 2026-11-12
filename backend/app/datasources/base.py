"""The DataSource interface: authoritative public datasets that can answer some questions at $0.

A source first `match`es a question (cheap, deterministic, high precision: a false match would show the
wrong data with full confidence), then `fetch`es a payload in exactly the LLM contract shape, so the rest of
the pipeline (validation, binning, caching) can't tell where it came from.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


class DataSourceError(Exception):
    """The source couldn't answer (network, empty data). The pipeline falls back to the LLM."""


@dataclass(frozen=True)
class SourceMatch:
    source: str  # e.g. "worldbank"
    indicator: str  # e.g. "SP.POP.TOTL"
    title: str
    year: int | None = None


@dataclass
class SourceResult:
    payload: dict[str, Any]  # {"meta": {...}, "rows": [...]}, the same shape the LLM returns
    source: dict[str, str]  # {"name", "indicator", "url"} shown in the info popover
    latency_ms: int = 0
    extra: dict[str, Any] = field(default_factory=dict)


class DataSource(Protocol):
    name: str

    def match(self, query: str) -> SourceMatch | None: ...

    async def fetch(self, match: SourceMatch) -> SourceResult: ...
