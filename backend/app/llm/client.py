"""Shared types for map generation: the result, token usage, the stable error type and the generator protocol.

The real generator is `openai_client.OpenAIMapGenerator`; `mock.MockMapGenerator` stands in for it in
mock mode and tests. Error messages are fixed strings, never upstream text, so API keys can't leak.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

ProgressFn = Callable[[int], Awaitable[None]]


class LLMError(Exception):
    """A failed generation. `code` is stable and safe to show; `message` never contains secrets."""

    def __init__(self, code: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass
class Usage:
    input_tokens: int = 0  # uncached input
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    web_searches: int = 0

    @property
    def prompt_tokens(self) -> int:
        return self.input_tokens + self.cache_read_tokens + self.cache_write_tokens


@dataclass
class LLMResult:
    payload: dict[str, Any] | None
    usage: Usage
    cost_usd: float
    model: str
    strategy: str  # "A" (knowledge only) or "B" (web search available)
    stop_reason: str | None
    salvaged: bool = False
    refusal: bool = False
    sources: list[dict[str, str]] = field(default_factory=list)
    latency_ms: int = 0


class MapGenerator(Protocol):
    model_id: str

    async def generate(
        self,
        query: str,
        *,
        api_key: str,
        web_search: bool = False,
        on_progress: ProgressFn | None = None,
    ) -> LLMResult: ...

    async def aclose(self) -> None: ...


def refusal_payload() -> dict[str, Any]:
    """What a safety decline becomes: an unmappable result."""
    return {
        "meta": {
            "status": "unmappable",
            "reason": "This request can't be turned into a map.",
            "suggestions": ["Population by country", "Average annual rainfall by country"],
        },
        "rows": [],
    }
