"""The user's OpenAI key: reading it from the request, its shape, and validation.

The key arrives only in the `X-OpenAI-Key` header and lives in local variables for one request. `UserKey`
hides it from `repr`, so it can't leak through logging or tracebacks.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from starlette.requests import Request

from ..config import Settings
from .openai_client import validate_openai_key

KEY_HEADER = "x-openai-key"
# OpenAI doesn't publish a key format; observed prefixes are sk-proj-, sk-svcacct- and legacy sk-.
KEY_SHAPE = re.compile(r"^sk-[A-Za-z0-9_\-]{20,400}$")
SHAPE_MESSAGE = "That doesn't look like an OpenAI API key (it starts with sk-)."


@dataclass(frozen=True)
class UserKey:
    key: str = field(repr=False)


@dataclass
class KeyCheck:
    valid: bool
    code: str | None = None
    message: str = ""


def read_key(request: Request) -> UserKey | None:
    raw = request.headers.get(KEY_HEADER)
    return UserKey(raw.strip()) if raw is not None and raw.strip() else None


def key_shape_ok(key: str) -> bool:
    return bool(KEY_SHAPE.match(key))


async def validate_key(key: str, settings: Settings) -> KeyCheck:
    """Live mode looks the model up with the key (no tokens). Mock mode checks only the shape, and
    treats a key containing "invalid" as rejected."""
    if not key_shape_ok(key):
        return KeyCheck(False, "invalid_key", SHAPE_MESSAGE)
    if settings.llm_mode == "mock":
        if "invalid" in key.lower():
            return KeyCheck(False, "invalid_key", "Your OpenAI API key was rejected.")
        return KeyCheck(True)
    valid, code, message = await validate_openai_key(key, settings)
    return KeyCheck(valid, code, message)
