"""LLM_MODE=mock: fixture responses, so the full UI works at zero API cost.

* Questions matching a fixture (WW1 deaths, rainfall, population, Olympic golds, ...) return that
  fixture's data. Several fixtures are real World Bank data; the rest are illustrative.
* Questions that look like chit-chat, coding or prompt injection return `unmappable`.
* Anything else gets deterministic synthetic values (seeded by the question), clearly labelled.

It streams progress like the real client, reports plausible token usage, and simulates prompt
caching (the first call in a 5-minute window "writes" the cache, later calls "read" it), so cost and
token displays behave realistically in development and tests.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import random
import re
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..config import Settings
from ..countries import load_countries
from .client import LLMError, LLMResult, ProgressFn, Usage
from .estimate import estimate_output_tokens, estimate_prompt_tokens, estimate_text_tokens
from .profiles import estimate_cost_usd, profile_for
from .prompt import STATIC_RULES, system_prompt

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
CACHE_TTL_S = 300

UNMAPPABLE = re.compile(
    r"\b(poem|haiku|joke|story|essay|recipe|code|coding|python|javascript|typescript|function|program|"
    r"script|sql|hello|hi|hey|thanks|thank you|who are you|how are you|ignore|instructions|system prompt|"
    r"translate|summari[sz]e|email|weather|capital of|meaning of life|write me|tell me about yourself)\b",
    re.IGNORECASE,
)


@lru_cache
def load_fixtures() -> list[dict[str, Any]]:
    fixtures = []
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        body = json.loads(path.read_text(encoding="utf-8"))
        body["_patterns"] = [re.compile(p, re.IGNORECASE) for p in body["match"]]
        fixtures.append(body)
    return fixtures


def unmappable_payload(query: str) -> dict[str, Any]:
    return {
        "meta": {
            "status": "unmappable",
            "reason": "This looks like a general request rather than something measured country by country.",
            "title": "", "metric_label": "", "unit": "", "time_scope": "", "value_type": "count",
            "higher_is": "neutral", "allows_negative": False, "suggested_scale": "quantile",
            "suggested_palette": "verdant", "recency_sensitive": False, "caveats": [],
            "suggestions": [
                "Average annual rainfall by country",
                "Internet users as a share of the population",
                "How many deaths were there in each country in World War 1?",
            ],
        },
        "rows": [],
    }


def synthetic_payload(query: str) -> dict[str, Any]:
    """Deterministic made-up data, seeded by the question, for questions without a fixture."""
    seed = int(hashlib.sha256(query.strip().lower().encode()).hexdigest()[:12], 16)
    rng = random.Random(seed)
    codes = [c.iso3 for c in load_countries().countries if not c.tiny or rng.random() < 0.4]
    chosen = sorted(rng.sample(codes, k=min(len(codes), rng.randint(110, 170))))
    scale = 10 ** rng.uniform(1, 5)
    rows = []
    for code in chosen:
        value = round(scale * rng.lognormvariate(0, 1.1), 1)
        conf = rng.choices(["h", "m", "l"], weights=[5, 3, 2])[0]
        rows.append([code, value, conf] + (["Synthetic value (mock mode)"] if conf == "l" else []))
    title = query.strip().rstrip("?").strip()
    title = (title[:1].upper() + title[1:])[:60] if title else "Mock Map"
    return {
        "meta": {
            "status": "ok", "reason": "", "title": title, "metric_label": "Synthetic values",
            "unit": "units", "time_scope": "mock data", "value_type": "count",
            "higher_is": rng.choice(["worse", "better", "neutral"]), "allows_negative": False,
            "suggested_scale": rng.choice(["quantile", "log", "linear"]),
            "suggested_palette": rng.choice(["verdant", "viridis", "inferno", "ice", "neon"]),
            "recency_sensitive": False,
            "caveats": ["Mock mode: these values are synthetic, for UI development only"],
            "suggestions": [],
        },
        "rows": rows,
    }


def mock_payload(query: str) -> dict[str, Any]:
    for fixture in load_fixtures():
        if any(p.search(query) for p in fixture["_patterns"]):
            return copy.deepcopy(fixture["payload"])
    if UNMAPPABLE.search(query):
        return unmappable_payload(query)
    return synthetic_payload(query)


class MockMapGenerator:
    """Drop-in replacement for OpenAIMapGenerator. `calls` counts generations and `keys` records the key
    each call used (tests use both). A key containing "invalid" is rejected, like a revoked key."""

    def __init__(self, settings: Settings, *, model_id: str | None = None):
        self.settings = settings
        self.model_id = model_id or settings.openai_model_id
        self.calls = 0
        self.keys: list[str | None] = []
        self._cache_written_at = 0.0

    async def aclose(self) -> None:
        return None

    async def fill_gaps(self, query, meta, have, codes, countries, *, api_key=None, web_search=False,
                        region_label=None) -> LLMResult:
        """Mock gap fill: answers null for every requested country (fixtures have no extra data), but
        still reports the small cost a real pass would have. `gap_calls` records the codes asked about."""
        self.gap_calls = getattr(self, "gap_calls", []) + [list(codes)]
        payload = {"rows": {c: None for c in codes}}
        usage = Usage(input_tokens=400 + 6 * len(codes), output_tokens=5 * len(codes))
        cost = estimate_cost_usd(profile_for(self.model_id), input_tokens=usage.input_tokens,
                                 output_tokens=usage.output_tokens)
        return LLMResult(payload=payload, usage=usage, cost_usd=cost, model=self.model_id,
                         strategy="B" if web_search else "A", stop_reason="completed")

    async def generate(
        self,
        query: str,
        *,
        api_key: str | None = None,
        web_search: bool = False,
        on_progress: ProgressFn | None = None,
        region=None,
    ) -> LLMResult:
        """Fixtures are world-wide; for a focus region the pipeline drops the rows outside it."""
        self.calls += 1
        self.keys.append(api_key)
        self.regions = getattr(self, "regions", []) + [region.id if region is not None else None]
        model = self.model_id
        profile = profile_for(model)
        started = time.perf_counter()
        if api_key is not None and "invalid" in api_key.lower():
            raise LLMError("invalid_key", "Your OpenAI API key was rejected. Check it in Settings.")
        payload = mock_payload(query)
        rows = len(payload["rows"])
        steps = 6
        delay = max(0, self.settings.mock_latency_ms) / 1000 / steps
        for i in range(1, steps + 1):
            if delay:
                await asyncio.sleep(delay)
            if on_progress:
                await on_progress(rows * i // steps)

        prompt_tokens = estimate_prompt_tokens(STATIC_RULES, system_prompt()[len(STATIC_RULES):])
        now = time.monotonic()
        cached = now - self._cache_written_at < CACHE_TTL_S
        if not cached:
            self._cache_written_at = now
        usage = Usage(
            input_tokens=30 + estimate_text_tokens(query),
            output_tokens=estimate_output_tokens(payload),
            cache_read_tokens=prompt_tokens if cached else 0,
            cache_write_tokens=0 if cached else prompt_tokens,
        )
        cost = estimate_cost_usd(
            profile, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens,
            cache_read_tokens=usage.cache_read_tokens, cache_write_tokens=usage.cache_write_tokens,
        )
        return LLMResult(
            payload=payload, usage=usage, cost_usd=cost, model=model,
            strategy="B" if web_search else "A", stop_reason="end_turn",
            latency_ms=int((time.perf_counter() - started) * 1000),
        )
