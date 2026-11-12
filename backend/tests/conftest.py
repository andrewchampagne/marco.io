from __future__ import annotations

import json
from collections.abc import Callable

import pytest
from starlette.testclient import TestClient

from app.config import Settings
from app.main import create_app

CSRF = {"X-Requested-With": "terrachrome-tests"}
KEY = "sk-proj-" + "k" * 48  # a well-shaped OpenAI key; mock mode accepts any key without "invalid"
SENTINEL_KEY = "sk-proj-SENTINELKEY0000000000000000000000000000000000000000000000"


def make_settings(tmp_path, **overrides) -> Settings:
    base = dict(
        llm_mode="mock", database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        mock_latency_ms=0, session_secret="test-secret-test-secret-test-secret", cookie_secure=True,
        datasources_enabled=False, rate_limit_per_minute=1000, maps_rate_limit_per_minute=1000,
        trust_proxy_headers=False, ip_hash_salt=None,
    )
    base.update(overrides)
    return Settings(_env_file=None, **base)  # tests never read the developer's .env


@pytest.fixture
def build(tmp_path) -> Callable[..., TestClient]:
    """build(**settings_overrides, generator=..., datasources=...) -> a TestClient on https://testserver."""
    clients: list[TestClient] = []

    def _build(*, generator=None, datasources=None, **overrides) -> TestClient:
        app = create_app(make_settings(tmp_path, **overrides), generator=generator, datasources=datasources,
                         serve_frontend=False)
        client = TestClient(app, base_url="https://testserver")
        client.__enter__()
        clients.append(client)
        return client

    yield _build
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(build) -> TestClient:
    return build()


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.split("\n\n"):
        name, data = None, None
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if name:
            events.append((name, data))
    return events


def make_map(client: TestClient, query: str, *, key: str | None = KEY):
    """POST /api/maps with the visitor's OpenAI key (pass key=None to send none).
    Returns (response, final_event_name, final_event_data)."""
    headers = dict(CSRF)
    if key is not None:
        headers["X-OpenAI-Key"] = key
    resp = client.post("/api/maps", json={"query": query}, headers=headers)
    if resp.headers.get("content-type", "").startswith("text/event-stream"):
        events = parse_sse(resp.text)
        name, data = events[-1]
        return resp, name, data
    return resp, None, resp.json()
