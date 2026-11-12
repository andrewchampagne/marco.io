"""Bring-your-own-key: which provider's key a request carries.

A key arrives in exactly one header: `X-OpenAI-Key` or `X-Anthropic-Key`. The header names the provider,
so the key itself is never inspected to route it. The key lives only in this object for one request;
`repr` hides it so it can't leak through logging or tracebacks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from starlette.requests import Request

from .errors import ApiError

Provider = Literal["openai", "anthropic"]
PROVIDERS: tuple[Provider, ...] = ("openai", "anthropic")
HEADERS: dict[Provider, str] = {"openai": "x-openai-key", "anthropic": "x-anthropic-key"}
LABELS: dict[Provider, str] = {"openai": "OpenAI", "anthropic": "Anthropic"}


@dataclass(frozen=True)
class ByokKey:
    provider: Provider
    key: str = field(repr=False)

    @property
    def label(self) -> str:
        return LABELS[self.provider]


def read_byok(request: Request) -> ByokKey | None:
    """The key on this request, if any. Two keys at once is a client bug, so it's rejected."""
    found = [(p, request.headers.get(h)) for p, h in HEADERS.items() if request.headers.get(h) is not None]
    if not found:
        return None
    if len(found) > 1:
        raise ApiError(400, "ambiguous_key", "Send one API key per request.")
    provider, key = found[0]
    return ByokKey(provider, key.strip())
