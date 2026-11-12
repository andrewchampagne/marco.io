"""GET /api/examples, GET /api/config, GET /api/health."""

from __future__ import annotations

from fastapi import APIRouter, Request

from .. import __version__
from ..llm.profiles import model_for

router = APIRouter()

CHIPS = [
    "How many deaths were there in each country in World War 1?",
    "Average annual rainfall by country",
    "Life expectancy at birth",
    "Coffee consumption per person",
    "Nuclear warheads by country",
    "Share of people using the internet",
]
PLACEHOLDERS = [
    "How many deaths were there in each country in World War 1?",
    "Average annual rainfall by country",
    "All-time Olympic gold medals by country",
    "CO₂ emissions per person",
    "UNESCO World Heritage Sites by country",
    "GDP per capita",
    "Forest cover as a share of land area",
    "How many times has each country won the World Cup?",
    "Coffee consumption per person",
    "Population by country",
]


@router.get("/api/examples")
def examples():
    return {"chips": CHIPS, "placeholders": PLACEHOLDERS}


@router.get("/api/config")
def config(request: Request):
    s = request.app.state.settings
    return {
        "version": __version__,
        "llm_mode": s.llm_mode,
        "auth_mode": s.auth_mode,
        "llm_provider": s.llm_provider,
        "model": model_for(s.llm_provider, s),
        "key_providers": ["openai", "anthropic"],
        "default_key_provider": "openai",
        "free_maps_per_day": s.free_maps_per_day,
        "max_query_chars": s.max_query_chars,
        "byok_enabled": s.byok_enabled,
        "datasources_enabled": s.datasources_enabled,
    }


@router.get("/api/health")
def health():
    return {"ok": True}
