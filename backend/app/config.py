"""Application settings, read from environment variables and the repo-root `.env` file.

Every setting has a safe default. With `LLM_MODE=mock` (the default) the app runs with no account or key
at all. Every AI call is paid for by the user's own OpenAI key, which arrives per request from the
browser; the server holds no AI key.
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
    # extra="ignore": settings removed in later versions (AUTH_MODE, quotas, ...) are simply ignored.
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- AI (OpenAI, paid with the user's own key) -------------------------------------------
    llm_mode: Literal["mock", "live"] = "mock"
    openai_model_id: str = "gpt-6.1-terra"
    openai_reasoning_effort: str | None = None  # None uses the model profile's default
    max_output_tokens: int = Field(4000, ge=256, le=32_000)
    llm_timeout_seconds: float = 90.0
    web_search_enabled: bool = True  # the model may search the web when data is recent
    web_search_max_uses: int = Field(3, ge=1, le=10)
    # Gap fill: after the main answer, one small follow-up call asks about each missing sovereign country by
    # name (value or explicit null). Runs only when the first pass already covers a world-scale share of
    # countries, so regional and "top N" questions are left alone.
    gap_fill_enabled: bool = True
    gap_fill_min_coverage: float = Field(0.35, ge=0.0, le=1.0)
    gap_fill_web_search: bool = False  # knowledge-only by default: fast and cheap
    datasources_enabled: bool = True  # strategy C: World Bank connector for catalog indicators
    datasource_timeout_seconds: float = 8.0
    mock_latency_ms: int = 1200

    # --- Cookies ---------------------------------------------------------------------------
    # Signs the anonymous visitor cookie (which owns history) and keys the IP hash used for rate limits.
    session_secret: SecretStr = SecretStr(DEV_SESSION_SECRET)
    cookie_secure: bool = True  # set false only for browsers that refuse Secure cookies on http://localhost

    # --- Storage ---------------------------------------------------------------------------
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'var' / 'marco.db').as_posix()}"

    # --- Abuse controls --------------------------------------------------------------------
    rate_limit_per_minute: int = 60
    maps_rate_limit_per_minute: int = 8
    max_query_chars: int = 200

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
