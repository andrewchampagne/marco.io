"""Per-model request settings and prices, so MODEL_ID / OPENAI_MODEL_ID can change without touching code.

Prices are USD per million tokens (checked 2026-11-11):
  * Anthropic: https://platform.claude.com/docs/en/about-claude/pricing. Cache writes use the 5-minute TTL price.
  * OpenAI: https://developers.openai.com/api/docs/pricing (Standard tier). Caching is automatic; writes
    on GPT-5.6+ models cost 1.25x input for the default 30-minute lifetime, reads 0.1x.
Web search costs $10 per 1,000 searches with either provider.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

WEB_SEARCH_USD_PER_SEARCH = 10.0 / 1000  # $10 per 1,000 searches


@dataclass(frozen=True)
class ModelProfile:
    model_id: str
    input_per_mtok: float
    output_per_mtok: float
    cache_write_per_mtok: float
    cache_read_per_mtok: float
    # Request params that turn thinking off for map generation, or None to omit `thinking`
    # (for models that don't think by default, or can't disable it).
    thinking_off: dict[str, Any] | None
    # Effort to send when thinking can't be disabled (Opus 5.5), to keep generation short.
    fallback_effort: str | None = None
    supports_forced_tool: bool = True
    min_cacheable_tokens: int = 512
    # Haiku 5.5 bills prompts over 100K tokens at a higher rate card.
    long_context_threshold: int | None = None
    long_context_multiplier: float = 1.0
    known: bool = True
    notes: list[str] = field(default_factory=list)
    provider: str = "anthropic"
    # OpenAI `reasoning.effort` for map generation: the lowest the model accepts.
    reasoning_effort: str | None = None


PROFILES: dict[str, ModelProfile] = {
    "claude-haiku-5-5": ModelProfile(
        "claude-haiku-5-5", 0.10, 0.50, 0.125, 0.01,
        thinking_off={"type": "disabled"},
        long_context_threshold=100_000, long_context_multiplier=5.0,
    ),
    "claude-sonnet-5-5": ModelProfile(
        "claude-sonnet-5-5", 2.00, 10.00, 2.50, 0.10,
        thinking_off={"type": "between_tools"}, supports_forced_tool=False,
    ),
    "claude-opus-5-5": ModelProfile(
        "claude-opus-5-5", 4.00, 20.00, 5.00, 0.20,
        thinking_off=None, fallback_effort="low", supports_forced_tool=False,
    ),
    "claude-haiku-4-5": ModelProfile(
        "claude-haiku-4-5", 1.00, 5.00, 1.25, 0.10,
        thinking_off=None, min_cacheable_tokens=4096,
    ),
    # OpenAI. gpt-6-luna is the cheapest current model; it accepts effort "none" (no reasoning tokens).
    "gpt-6-luna": ModelProfile(
        "gpt-6-luna", 0.10, 0.50, 0.125, 0.01, thinking_off=None, min_cacheable_tokens=1024,
        provider="openai", reasoning_effort="none",
    ),
    "gpt-6.1-terra": ModelProfile(
        "gpt-6.1-terra", 1.00, 5.00, 1.25, 0.05, thinking_off=None, min_cacheable_tokens=1024,
        provider="openai", reasoning_effort="low",
    ),
    "gpt-6.1-sol": ModelProfile(  # rejects effort none/minimal
        "gpt-6.1-sol", 2.00, 10.00, 2.50, 0.10, thinking_off=None, min_cacheable_tokens=1024,
        provider="openai", reasoning_effort="low",
    ),
}


def model_for(provider: str, settings: Any) -> str:
    """The configured model for a provider ("openai" or "anthropic")."""
    return settings.openai_model_id if provider == "openai" else settings.model_id


def profile_for(model_id: str) -> ModelProfile:
    """The profile for `model_id`. Unknown models get Sonnet-level prices so cost estimates err high."""
    if model_id in PROFILES:
        return PROFILES[model_id]
    log.warning("No pricing profile for model %r; estimating costs at Sonnet 5.5 rates", model_id)
    is_openai = not model_id.startswith("claude")
    return ModelProfile(model_id, 2.00, 10.00, 2.50, 0.20, thinking_off=None,
                        supports_forced_tool=False, known=False,
                        provider="openai" if is_openai else "anthropic",
                        reasoning_effort="low" if is_openai else None)


def estimate_cost_usd(
    profile: ModelProfile,
    *,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    web_searches: int = 0,
) -> float:
    """Dollar cost of one request from its `usage` numbers."""
    prompt_tokens = input_tokens + cache_read_tokens + cache_write_tokens
    mult = 1.0
    if profile.long_context_threshold and prompt_tokens > profile.long_context_threshold:
        mult = profile.long_context_multiplier
    cost = (
        input_tokens * profile.input_per_mtok
        + output_tokens * profile.output_per_mtok
        + cache_read_tokens * profile.cache_read_per_mtok
        + cache_write_tokens * profile.cache_write_per_mtok
    ) * mult / 1_000_000
    return round(cost + web_searches * WEB_SEARCH_USD_PER_SEARCH, 8)
