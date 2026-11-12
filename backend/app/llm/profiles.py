"""Per-model request settings and prices, so OPENAI_MODEL_ID can change without touching code.

Prices are USD per million tokens, Standard tier, from https://developers.openai.com/api/docs/pricing
(checked 2026-11-11). Prompt caching is automatic; on GPT-5.6+ models cache writes cost 1.25x input
(default 30-minute lifetime) and reads 0.1x. Web search costs $10 per 1,000 searches.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)

WEB_SEARCH_USD_PER_SEARCH = 10.0 / 1000


@dataclass(frozen=True)
class ModelProfile:
    model_id: str
    input_per_mtok: float
    output_per_mtok: float
    cache_write_per_mtok: float
    cache_read_per_mtok: float
    # `reasoning.effort` for map generation: the lowest the model accepts.
    reasoning_effort: str | None = None
    min_cacheable_tokens: int = 1024
    known: bool = True


PROFILES: dict[str, ModelProfile] = {
    # The cheapest current model; it accepts effort "none" (no reasoning tokens).
    "gpt-6-luna": ModelProfile("gpt-6-luna", 0.10, 0.50, 0.125, 0.01, reasoning_effort="none"),
    "gpt-6.1-terra": ModelProfile("gpt-6.1-terra", 1.00, 5.00, 1.25, 0.05, reasoning_effort="low"),
    # rejects effort none/minimal
    "gpt-6.1-sol": ModelProfile("gpt-6.1-sol", 2.00, 10.00, 2.50, 0.10, reasoning_effort="low"),
}


def profile_for(model_id: str) -> ModelProfile:
    """The profile for `model_id`. Unknown models get gpt-6.1-sol prices so cost estimates err high."""
    if model_id in PROFILES:
        return PROFILES[model_id]
    log.warning("No pricing profile for model %r; estimating costs at gpt-6.1-sol rates", model_id)
    return ModelProfile(model_id, 2.00, 10.00, 2.50, 0.10, reasoning_effort="low", known=False)


def estimate_cost_usd(
    profile: ModelProfile,
    *,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    web_searches: int = 0,
) -> float:
    """Dollar cost of one request from its `usage` numbers (input_tokens = uncached input)."""
    cost = (
        input_tokens * profile.input_per_mtok
        + output_tokens * profile.output_per_mtok
        + cache_read_tokens * profile.cache_read_per_mtok
        + cache_write_tokens * profile.cache_write_per_mtok
    ) / 1_000_000
    return round(cost + web_searches * WEB_SEARCH_USD_PER_SEARCH, 8)
