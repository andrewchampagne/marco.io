"""The visitor's OpenAI key: validation, never stored or logged, redaction; plus visitor cookie and proxy rules."""

import logging
import sys

from sqlalchemy import text

from app.llm.keys import UserKey
from app.logging_setup import RedactKeysFilter, redact

from .conftest import CSRF, KEY, SENTINEL_KEY, make_map

WW1 = "How many deaths were there in each country in World War 1?"


def set_cookie_headers(resp):
    return [v for k, v in resp.headers.multi_items() if k.lower() == "set-cookie"]


def test_key_validation_needs_no_account(client):
    ok = client.post("/api/key/validate", headers={**CSRF, "X-OpenAI-Key": KEY}).json()
    assert ok["valid"] is True and ok["model"] == "gpt-6.1-terra"
    legacy = client.post("/api/key/validate", headers={**CSRF, "X-OpenAI-Key": "sk-" + "L" * 48}).json()
    assert legacy["valid"] is True
    bad = client.post("/api/key/validate", headers={**CSRF, "X-OpenAI-Key": "sk-proj-invalid" + "x" * 30}).json()
    assert bad["valid"] is False and bad["code"] == "invalid_key"
    shape = client.post("/api/key/validate", headers={**CSRF, "X-OpenAI-Key": "hello"}).json()
    assert shape["valid"] is False and "OpenAI" in shape["message"]
    missing = client.post("/api/key/validate", headers=CSRF)
    assert missing.status_code == 400 and missing.json()["code"] == "missing_key"


def test_key_never_appears_in_logs_responses_or_db(client, caplog):
    caplog.set_level(logging.DEBUG)
    bodies = [client.post("/api/key/validate", headers={**CSRF, "X-OpenAI-Key": SENTINEL_KEY}).text]
    for q in (WW1, "Average annual rainfall"):
        bodies.append(make_map(client, q, key=SENTINEL_KEY)[0].text)
    bad = SENTINEL_KEY.replace("SENTINEL", "invalidSENTINEL")
    bodies.append(make_map(client, "Coffee consumption per person", key=bad)[0].text)
    bodies.append(make_map(client, "x" * 300, key=SENTINEL_KEY)[0].text)  # a pre-flight error
    bodies.append(client.get("/api/export").text)
    bodies.append(client.get("/api/history").text)

    assert "SENTINELKEY000" not in caplog.text
    assert all("SENTINELKEY000" not in b for b in bodies)
    with client.app.state.engine.connect() as conn:
        for table in ("maps", "usage_events", "history_entries"):
            for row in conn.execute(text(f"SELECT * FROM {table}")):
                assert "SENTINELKEY000" not in repr(row), table


def test_user_key_hides_itself_from_repr():
    assert "SENTINEL" not in repr(UserKey(SENTINEL_KEY))


def test_redaction_covers_openai_key_formats_but_not_ordinary_words():
    assert redact(f"key={SENTINEL_KEY} end") == "key=sk-proj-[REDACTED] end"
    assert redact("sk-svcacct-" + "b" * 40) == "sk-svcacct-[REDACTED]"
    assert redact("legacy sk-" + "c" * 48) == "legacy sk-[REDACTED]"
    assert redact("we use sk-learn and task-runner") == "we use sk-learn and task-runner"


def test_redaction_filter_scrubs_messages_args_and_tracebacks():
    record = logging.LogRecord("x", logging.ERROR, __file__, 1, "upstream said %s", (SENTINEL_KEY,), None)
    try:
        raise RuntimeError(f"boom {SENTINEL_KEY}")
    except RuntimeError:
        record.exc_info = sys.exc_info()
    RedactKeysFilter().filter(record)
    assert "SENTINELKEY000" not in record.getMessage() and "SENTINELKEY000" not in record.exc_text


def test_visitor_cookie_flags(build):
    fresh = build()
    cookie = next(c for c in set_cookie_headers(fresh.get("/api/history")) if c.startswith("tc_vid="))
    lowered = cookie.lower()
    assert "httponly" in lowered and "secure" in lowered and "samesite=lax" in lowered and "max-age=" in lowered


def test_proxy_headers_ignored_unless_trusted(build):
    client = build(maps_rate_limit_per_minute=2)
    for _ in range(2):
        make_map(client, WW1)
    resp = client.post("/api/maps", json={"query": WW1},
                       headers={**CSRF, "X-OpenAI-Key": KEY, "X-Forwarded-For": "203.0.113.9"})
    assert resp.status_code == 429  # a spoofed XFF doesn't buy a new rate-limit identity


def test_trusted_proxy_header_sets_client_ip(build):
    client = build(trust_proxy_headers=True, maps_rate_limit_per_minute=2)
    for _ in range(2):
        client.post("/api/maps", json={"query": WW1},
                    headers={**CSRF, "X-OpenAI-Key": KEY, "X-Forwarded-For": "198.51.100.1"})
    other = client.post("/api/maps", json={"query": WW1},
                        headers={**CSRF, "X-OpenAI-Key": KEY, "X-Forwarded-For": "198.51.100.2"})
    assert other.status_code == 200
