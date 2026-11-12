"""FastAPI application factory.

    uvicorn app.main:app --reload          (from backend/)

`create_app()` takes optional overrides (settings, generator, data sources) so tests can build isolated
apps with a temporary database and fake collaborators.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware

from . import __version__
from .auth import build_oauth
from .config import DEV_SESSION_SECRET, REPO_ROOT, Settings, get_settings
from .countries import load_countries
from .datasources.base import DataSource
from .datasources.worldbank import WorldBankSource
from .db import make_engine, make_session_factory
from .errors import install_error_handlers
from .identity import OAUTH_COOKIE, Keys, VisitorMiddleware
from .llm.client import AnthropicMapGenerator
from .llm.mock import MockMapGenerator
from .logging_setup import configure_logging
from .migrations import migrate
from .ratelimit import CsrfMiddleware, InFlight, RateLimitMiddleware
from .routes import account, auth, maps, meta
from .spa import mount_spa

log = logging.getLogger("app")
WEAK_SECRETS = {DEV_SESSION_SECRET, "change-me-to-a-long-random-string"}


def create_app(
    settings: Settings | None = None,
    *,
    generator=None,
    datasources: list[DataSource] | None = None,
    serve_frontend: bool = True,
    frontend_dist: Path | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()
    secret = settings.session_secret.get_secret_value()
    if settings.auth_mode == "google" and (secret in WEAK_SECRETS or len(secret) < 32):
        raise RuntimeError("Set SESSION_SECRET to a long random value (32+ characters) before enabling Google sign-in.")

    engine = make_engine(settings.database_url)
    migrate(engine)
    keys = Keys(settings)
    if generator is None:
        generator = MockMapGenerator(settings) if settings.llm_mode == "mock" else AnthropicMapGenerator(settings)
    if datasources is None:
        datasources = [WorldBankSource(timeout=settings.datasource_timeout_seconds)]

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        log.info("Terrachrome %s: LLM_MODE=%s AUTH_MODE=%s MODEL_ID=%s", __version__, settings.llm_mode,
                 settings.auth_mode, settings.model_id)
        yield
        await generator.aclose()
        engine.dispose()

    app = FastAPI(title="Terrachrome API", version=__version__, lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = make_session_factory(engine)
    app.state.keys = keys
    app.state.generator = generator
    app.state.datasources = datasources
    app.state.countries = load_countries()
    app.state.inflight = InFlight()
    app.state.oauth = build_oauth(settings)

    install_error_handlers(app)
    for router in (maps.router, account.router, auth.router, meta.router):
        app.include_router(router)
    if serve_frontend:
        mount_spa(app, frontend_dist or REPO_ROOT / "frontend" / "dist")

    # Middleware runs outermost-last-added: visitor identity -> rate limit -> CSRF -> OAuth session.
    app.add_middleware(
        SessionMiddleware, secret_key=keys.oauth_secret, session_cookie=OAUTH_COOKIE, max_age=600,
        same_site="lax", https_only=settings.cookie_secure,
    )
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(RateLimitMiddleware, settings=settings, keys=keys)
    app.add_middleware(VisitorMiddleware, settings=settings, keys=keys)
    # Outermost: compress JSON and static files (the country GeoJSON shrinks ~4x). Starlette never gzips
    # text/event-stream, so map streaming stays incremental.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    return app


def __getattr__(name: str):
    # `uvicorn app.main:app` builds the app lazily, so importing this module (e.g. in tests) has no side effects.
    if name == "app":
        return create_app()
    raise AttributeError(name)
