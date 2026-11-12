"""BYOK key checks. The key lives only in local variables for the length of one request."""

from __future__ import annotations

import re
from dataclasses import dataclass

import anthropic

from ..config import Settings
from .client import LLMError, map_api_error
from .profiles import profile_for

KEY_SHAPE = re.compile(r"^sk-ant-[A-Za-z0-9_\-]{20,200}$")


@dataclass
class KeyCheck:
    valid: bool
    code: str | None = None
    message: str = ""


def key_shape_ok(key: str) -> bool:
    return bool(KEY_SHAPE.match(key))


async def validate_key(key: str, settings: Settings) -> KeyCheck:
    """A minimal real call (1 output token on MODEL_ID). Mock mode only checks the shape."""
    if not key_shape_ok(key):
        return KeyCheck(False, "invalid_key", "That doesn't look like an Anthropic API key (sk-ant-…).")
    if settings.llm_mode == "mock":
        if "invalid" in key.lower():
            return KeyCheck(False, "invalid_key", "Your Anthropic API key was rejected.")
        return KeyCheck(True)
    profile = profile_for(settings.model_id)
    params: dict = {"model": settings.model_id, "max_tokens": 1, "messages": [{"role": "user", "content": "ping"}]}
    if profile.thinking_off is not None:
        params["thinking"] = profile.thinking_off
    client = anthropic.AsyncAnthropic(api_key=key, max_retries=0, timeout=20)
    try:
        await client.messages.create(**params)
        return KeyCheck(True)
    except anthropic.RateLimitError:
        return KeyCheck(True, "rate_limited", "Your key works, but it's rate-limited right now.")
    except anthropic.APIError as exc:
        err = map_api_error(exc, byok=True)
        if err.code in ("invalid_key", "no_credit"):
            return KeyCheck(False, err.code, err.message)
        raise LLMError("unavailable", "Couldn't reach Anthropic to check the key. Try again.", retryable=True) from None
    finally:
        await client.close()
