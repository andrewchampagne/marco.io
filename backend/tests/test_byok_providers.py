"""BYOK with either provider: the header picks the provider, the same sign-in and redaction rules apply."""

import logging

from sqlalchemy import select, text

from app.logging_setup import redact
from app.models import Map, UsageEvent

from .conftest import CSRF, OPENAI_SENTINEL_KEY, login, make_map

WW1 = "How many deaths were there in each country in World War 1?"
OPENAI_KEY = "sk-proj-" + "o" * 60
ANTHROPIC_KEY = "sk-ant-api03-" + "a" * 60


def test_free_tier_uses_openai_by_default(client):
    _, name, data = make_map(client, WW1)
    assert name == "result"
    assert client.app.state.generator.providers == ["openai"]
    with client.app.state.session_factory() as db:
        assert db.scalars(select(Map)).one().model == "gpt-6-luna"
    config = client.get("/api/config").json()
    assert config["llm_provider"] == "openai" and config["default_key_provider"] == "openai"
    assert config["key_providers"] == ["openai", "anthropic"] and config["model"] == "gpt-6-luna"


def test_server_provider_can_be_anthropic(build):
    client = build(llm_provider="anthropic")
    make_map(client, WW1)
    assert client.app.state.generator.providers == ["anthropic"]
    assert client.get("/api/config").json()["model"] == "claude-haiku-5-5"


def test_live_mode_routes_through_both_real_clients(build):
    client = build(llm_mode="live", openai_api_key=None, anthropic_api_key=None)
    router = client.app.state.generator
    assert set(router.generators) == {"openai", "anthropic"} and router.model_id == "gpt-6-luna"
    _, name, data = make_map(client, WW1)  # no server key: a clear, uncounted error, no network call
    assert name == "error" and data["code"] == "llm_unconfigured" and "OpenAI" in data["message"]
    assert client.get("/api/usage").json()["used"] == 0


def test_openai_key_requires_session(client):
    resp, _, body = make_map(client, WW1, key=OPENAI_KEY, provider="openai")
    assert resp.status_code == 403 and body["code"] == "signin_required"
    r = client.post("/api/key/validate", headers={**CSRF, "X-OpenAI-Key": OPENAI_KEY})
    assert r.status_code == 403 and r.json()["code"] == "signin_required"


def test_each_key_routes_to_its_provider_unlimited_and_uncounted(client):
    login(client)
    for i, q in enumerate(["Population by country", "Average annual rainfall", "Life expectancy at birth",
                           "Coffee consumption per person"]):
        key, provider = (OPENAI_KEY, "openai") if i % 2 == 0 else (ANTHROPIC_KEY, "anthropic")
        resp, name, data = make_map(client, q, key=key, provider=provider)
        assert resp.status_code == 200 and name == "result", data
    assert client.app.state.generator.providers == ["openai", "anthropic", "openai", "anthropic"]
    assert client.get("/api/usage").json()["used"] == 0
    assert client.get("/api/usage", headers={"X-OpenAI-Key": OPENAI_KEY}).json()["byok"] is True
    with client.app.state.session_factory() as db:
        assert all(e.byok and not e.counted for e in db.scalars(select(UsageEvent)))
        assert [m.model for m in db.scalars(select(Map).order_by(Map.id))] == [
            "gpt-6-luna", "claude-haiku-5-5", "gpt-6-luna", "claude-haiku-5-5"]


def test_two_keys_at_once_are_rejected(client):
    login(client)
    r = client.post("/api/maps", json={"query": WW1},
                    headers={**CSRF, "X-OpenAI-Key": OPENAI_KEY, "X-Anthropic-Key": ANTHROPIC_KEY})
    assert r.status_code == 400 and r.json()["code"] == "ambiguous_key"


def test_openai_key_validation_in_mock_mode(client):
    login(client)
    ok = client.post("/api/key/validate", headers={**CSRF, "X-OpenAI-Key": OPENAI_KEY}).json()
    assert ok["valid"] is True and ok["provider"] == "openai" and ok["model"] == "gpt-6-luna"
    legacy = client.post("/api/key/validate", headers={**CSRF, "X-OpenAI-Key": "sk-" + "L" * 48}).json()
    assert legacy["valid"] is True
    wrong = client.post("/api/key/validate", headers={**CSRF, "X-OpenAI-Key": ANTHROPIC_KEY}).json()
    assert wrong["valid"] is False and "Anthropic key" in wrong["message"]
    bad = client.post("/api/key/validate", headers={**CSRF, "X-OpenAI-Key": "sk-proj-invalid" + "x" * 30}).json()
    assert bad["valid"] is False and bad["code"] == "invalid_key" and "OpenAI" in bad["message"]
    anth = client.post("/api/key/validate", headers={**CSRF, "X-Anthropic-Key": ANTHROPIC_KEY}).json()
    assert anth["provider"] == "anthropic" and anth["model"] == "claude-haiku-5-5"


def test_bad_openai_key_shape_is_400_and_invalid_key_is_an_event(client):
    login(client)
    resp, _, body = make_map(client, WW1, key="hello", provider="openai")
    assert resp.status_code == 400 and body["code"] == "invalid_key" and "OpenAI" in body["message"]
    _, name, data = make_map(client, WW1, key="sk-proj-invalid" + "x" * 30, provider="openai")
    assert name == "error" and data["code"] == "invalid_key" and "OpenAI" in data["message"]


def test_openai_key_never_appears_in_logs_responses_or_db(client, caplog):
    caplog.set_level(logging.DEBUG)
    login(client)
    bodies = [client.post("/api/key/validate", headers={**CSRF, "X-OpenAI-Key": OPENAI_SENTINEL_KEY}).text]
    for q in (WW1, "Average annual rainfall"):
        bodies.append(make_map(client, q, key=OPENAI_SENTINEL_KEY, provider="openai")[0].text)
    bad = OPENAI_SENTINEL_KEY.replace("SENTINEL", "invalidSENTINEL")
    bodies.append(make_map(client, "Coffee consumption per person", key=bad, provider="openai")[0].text)
    client.post("/api/auth/logout", headers=CSRF)
    bodies.append(make_map(client, WW1, key=OPENAI_SENTINEL_KEY, provider="openai")[0].text)
    bodies.append(client.get("/api/me/export").text)

    assert "SENTINELKEY000" not in caplog.text
    assert all("SENTINELKEY000" not in b for b in bodies)
    with client.app.state.engine.connect() as conn:
        for table in ("users", "maps", "usage_events", "history_entries"):
            for row in conn.execute(text(f"SELECT * FROM {table}")):
                assert "SENTINELKEY000" not in repr(row), table


def test_redaction_covers_openai_key_formats_but_not_ordinary_words():
    assert redact(f"key={OPENAI_SENTINEL_KEY} end") == "key=sk-proj-[REDACTED] end"
    assert redact("sk-svcacct-" + "b" * 40) == "sk-svcacct-[REDACTED]"
    assert redact("legacy sk-" + "c" * 48) == "legacy sk-[REDACTED]"
    assert redact("sk-ant-api03-" + "d" * 40) == "sk-ant-[REDACTED]"
    assert redact("we use sk-learn and task-runner") == "we use sk-learn and task-runner"
