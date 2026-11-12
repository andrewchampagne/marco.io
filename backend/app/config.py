"""Application settings, read from environment variables and the repo-root `.env` file.

Every setting has a safe default, so `LLM_MODE=mock` + `AUTH_MODE=mock` (the defaults) run with no
external accounts at all.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
DATA_DIR = REPO_ROOT / "data"
DEV_SESSION_SECRET = "dev-only-insecure-session-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- LLM -------------------------------------------------------------------------------
    llm_mode: Literal["mock", "live"] = "mock"
    model_id: str = "claude-haiku-5-5"
    anthropic_api_key: SecretStr | None = None
    max_output_tokens: int = Field(4000, ge=256, le=32_000)
    llm_effort: Literal["low", "medium", "high"] | None = None
    llm_timeout_seconds: float = 90.0
    web_search_tool: str = "web_search_20250305"
    web_search_max_uses: int = Field(3, ge=1, le=10)
    admin_web_search: bool = False  # lets free-tier requests use web search too (operator's cost)
    datasources_enabled: bool = True  # strategy C: World Bank connector for catalog indicators
    datasource_timeout_seconds: float = 8.0
    mock_latency_ms: int = 1200

    # --- Auth and sessions -----------------------------------------------------------------
    auth_mode: Literal["mock", "google"] = "mock"
    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    session_secret: SecretStr = SecretStr(DEV_SESSION_SECRET)
    session_max_age_days: int = 30
    cookie_secure: bool = True  # set false only for browsers that refuse Secure cookies on http://localhost
    public_base_url: str | None = None  # e.g. https://maps.example.com; used to build the OAuth redirect URI

    # --- Storage ---------------------------------------------------------------------------
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'var' / 'terrachrome.db').as_posix()}"

    # --- Quotas and cost control -----------------------------------------------------------
    free_maps_per_day: int = 3
    free_maps_per_ip_per_day: int = 3  # raise for shared-NAT deployments (campuses, offices)
    daily_budget_usd: float = 1.00  # free-tier spend per UTC day before the circuit breaker trips
    rate_limit_per_minute: int = 60
    maps_rate_limit_per_minute: int = 8
    max_query_chars: int = 200
    byok_enabled: bool = True

    # --- Client IP and proxies -------------------------------------------------------------
    trust_proxy_headers: bool = False
    proxy_ip_header: str = "x-forwarded-for"
    trusted_proxy_hops: int = 1
    ip_hash_salt: SecretStr | None = None  # defaults to a key derived from SESSION_SECRET

    # --- Cache -----------------------------------------------------------------------------
    cache_ttl_days: int = 30
    recent_cache_ttl_hours: int = 24


@lru_cache
def get_settings() -> Settings:
    return Settings()
