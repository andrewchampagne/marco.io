"""BYOK key checks for both providers. The key lives only in local variables for the length of one request."""

from __future__ import annotations

import re
from dataclasses import dataclass

import anthropic

from ..config import Settings
from .client import LLMError, map_api_error
from .openai_client import validate_openai_key
from .profiles import model_for, profile_for

__all__ = ["KeyCheck", "key_shape_ok", "model_for", "shape_message", "validate_key"]

# OpenAI doesn't publish a key format; observed prefixes are sk-proj-, sk-svcacct- and legacy sk-.
# So the OpenAI check is loose: any sk- key that isn't an Anthropic key.
KEY_SHAPES = {
    "anthropic": re.compile(r"^sk-ant-[A-Za-z0-9_\-]{20,200}$"),
    "openai": re.compile(r"^sk-(?!ant-)[A-Za-z0-9_\-]{20,400}$"),
}


@dataclass
class KeyCheck:
    valid: bool
    code: str | None = None
    message: str = ""


def key_shape_ok(key: str, provider: str = "anthropic") -> bool:
    pattern = KEY_SHAPES.get(provider)
    return bool(pattern and pattern.match(key))


def shape_message(provider: str) -> str:
    if provider == "openai":
        return "That doesn't look like an OpenAI API key (sk-…)."
    return "That doesn't look like an Anthropic API key (sk-ant-…)."


async def validate_key(key: str, provider: str, settings: Settings) -> KeyCheck:
    """A minimal real call. Mock mode only checks the shape (a key containing "invalid" is rejected)."""
    label = "OpenAI" if provider == "openai" else "Anthropic"
    if not key_shape_ok(key, provider):
        hint = ""
        if provider == "openai" and key.startswith("sk-ant-"):
            hint = " It looks like an Anthropic key: choose Anthropic as the provider."
        return KeyCheck(False, "invalid_key", shape_message(provider) + hint)
    if settings.llm_mode == "mock":
        if "invalid" in key.lower():
            return KeyCheck(False, "invalid_key", f"Your {label} API key was rejected.")
        return KeyCheck(True)
    if provider == "openai":
        valid, code, message = await validate_openai_key(key, settings)
        return KeyCheck(valid, code, message)
    return await _validate_anthropic(key, settings)


async def _validate_anthropic(key: str, settings: Settings) -> KeyCheck:
    """1 output token on MODEL_ID."""
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
