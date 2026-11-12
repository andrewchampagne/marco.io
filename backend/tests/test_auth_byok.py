import logging

from sqlalchemy import func, select, text

from app.logging_setup import RedactKeysFilter, redact
from app.models import HistoryEntry, Map, UsageEvent, User

from .conftest import CSRF, SENTINEL_KEY, login, make_map

WW1 = "How many deaths were there in each country in World War 1?"
GOOD_KEY = "sk-ant-api03-" + "g" * 60


def set_cookie_headers(resp):
    return [v for k, v in resp.headers.multi_items() if k.lower() == "set-cookie"]


def test_mock_google_login_and_callback(client):
    assert client.get("/api/me").json() == {"signed_in": False, "name": None, "email": None, "avatar_url": None}
    login(client, "alice")
    me = client.get("/api/me").json()
    assert me["signed_in"] and me["name"] == "Alice" and me["email"] == "alice@example.com"
    with client.app.state.session_factory() as db:
        user = db.scalars(select(User)).one()
        assert user.google_sub == "mock-alice"


def test_callback_rejects_bad_state_and_open_redirects(client):
    r = client.get("/api/auth/google/login?next=https://evil.example/x", follow_redirects=False)
    cb = r.headers["location"].replace("state=", "state=tampered")
    out = client.get(cb, follow_redirects=False)
    assert out.status_code == 302 and out.headers["location"].startswith("/?auth_error=state")
    assert client.get("/api/me").json()["signed_in"] is False


def test_session_cookie_flags(client):
    r = client.get("/api/auth/google/login?mock_user=bob", follow_redirects=False)
    cb = client.get(r.headers["location"], follow_redirects=False)
    session = next(c for c in set_cookie_headers(cb) if c.startswith("tc_session="))
    lowered = session.lower()
    assert "httponly" in lowered and "secure" in lowered and "samesite=lax" in lowered
    assert "max-age=2592000" in lowered and "path=/" in lowered
    visitor = client.get("/api/usage")
    # the visitor cookie was minted earlier; a fresh client shows its flags
    assert visitor.status_code == 200


def test_visitor_cookie_flags(build):
    fresh = build()
    cookie = next(c for c in set_cookie_headers(fresh.get("/api/usage")) if c.startswith("tc_vid="))
    lowered = cookie.lower()
    assert "httponly" in lowered and "secure" in lowered and "samesite=lax" in lowered and "max-age=" in lowered


def test_logout_clears_session(client):
    login(client)
    r = client.post("/api/auth/logout", headers=CSRF)
    assert r.status_code == 200
    assert client.get("/api/me").json()["signed_in"] is False


def test_anonymous_maps_and_history_are_claimed_on_sign_in(client):
    _, _, data = make_map(client, WW1)
    login(client, "carol")
    with client.app.state.session_factory() as db:
        uid = db.scalar(select(User.id))
        assert db.scalar(select(Map.user_id).where(Map.slug == data["slug"])) == uid
        assert db.scalar(select(func.count()).select_from(HistoryEntry).where(HistoryEntry.user_id == uid)) == 1
        assert db.scalar(select(func.count()).select_from(UsageEvent).where(UsageEvent.user_id == uid)) == 1
    assert client.get("/api/history").json()["items"][0]["query"] == WW1


def test_signing_in_does_not_reset_quota(client):
    for q in ("Population by country", "Average annual rainfall", "Life expectancy at birth"):
        make_map(client, q)
    login(client)
    usage = client.get("/api/usage").json()
    assert usage["signed_in"] and usage["remaining"] == 0
    resp, _, body = make_map(client, "Coffee consumption per person")
    assert resp.status_code == 429 and body["code"] == "quota_exceeded" and body["signed_in"] is True


def test_signed_in_without_key_still_has_three_per_day(client):
    login(client)
    for q in ("Population by country", "Average annual rainfall", "Life expectancy at birth"):
        assert make_map(client, q)[1] == "result"
    resp, _, body = make_map(client, "Coffee consumption per person")
    assert resp.status_code == 429 and body["signed_in"] is True


def test_byok_requires_session(client):
    resp, _, body = make_map(client, WW1, key=GOOD_KEY)
    assert resp.status_code == 403 and body["code"] == "signin_required"
    r = client.post("/api/key/validate", headers={**CSRF, "X-Anthropic-Key": GOOD_KEY})
    assert r.status_code == 403 and r.json()["code"] == "signin_required"


def test_byok_is_unlimited_and_uncounted(client):
    login(client)
    queries = ["Population by country", "Average annual rainfall", "Life expectancy at birth",
               "Coffee consumption per person", "Nuclear warheads by country"]
    for q in queries:
        resp, name, data = make_map(client, q, key=GOOD_KEY)
        assert resp.status_code == 200 and name == "result", data
    assert data["usage"]["byok"] is True
    usage = client.get("/api/usage").json()
    assert usage["used"] == 0
    assert client.get("/api/usage", headers={"X-Anthropic-Key": GOOD_KEY}).json()["byok"] is True
    with client.app.state.session_factory() as db:
        events = db.scalars(select(UsageEvent)).all()
        assert len(events) == 5 and all(e.byok and not e.counted for e in events)


def test_key_validation_in_mock_mode(client):
    login(client)
    ok = client.post("/api/key/validate", headers={**CSRF, "X-Anthropic-Key": GOOD_KEY}).json()
    assert ok["valid"] is True
    bad = client.post("/api/key/validate", headers={**CSRF, "X-Anthropic-Key": "sk-ant-api03-invalid" + "x" * 30}).json()
    assert bad["valid"] is False and bad["code"] == "invalid_key"
    shape = client.post("/api/key/validate", headers={**CSRF, "X-Anthropic-Key": "hello"}).json()
    assert shape["valid"] is False
    assert client.post("/api/key/validate", headers=CSRF).json()["code"] == "missing_key"


def test_invalid_byok_key_surfaces_as_invalid_key_event(client):
    login(client)
    _, name, data = make_map(client, WW1, key="sk-ant-api03-invalid" + "x" * 30)
    assert name == "error" and data["code"] == "invalid_key"


def test_account_deletion_removes_all_rows(client):
    login(client, "dave")
    make_map(client, WW1)
    make_map(client, "Population by country", key=GOOD_KEY)
    r = client.delete("/api/me", headers=CSRF)
    assert r.status_code == 200 and r.json()["deleted"] is True
    with client.app.state.session_factory() as db:
        for model in (User, Map, HistoryEntry, UsageEvent):
            assert db.scalar(select(func.count()).select_from(model)) == 0, model.__name__
    assert client.get("/api/me").json()["signed_in"] is False


def test_byok_key_never_appears_in_logs_responses_or_db(client, caplog):
    caplog.set_level(logging.DEBUG)
    login(client)
    bodies = []
    r = client.post("/api/key/validate", headers={**CSRF, "X-Anthropic-Key": SENTINEL_KEY})
    bodies.append(r.text)
    for q in (WW1, "Average annual rainfall"):
        resp, _, _ = make_map(client, q, key=SENTINEL_KEY)
        bodies.append(resp.text)
    # error paths: an invalid key and a key sent without a session
    bad = SENTINEL_KEY.replace("SENTINEL", "invalidSENTINEL")
    bodies.append(make_map(client, "Coffee consumption per person", key=bad)[0].text)
    client.post("/api/auth/logout", headers=CSRF)
    bodies.append(make_map(client, WW1, key=SENTINEL_KEY)[0].text)
    bodies.append(client.get("/api/me/export").text)

    assert "SENTINELKEY000" not in caplog.text
    assert all("SENTINELKEY000" not in b for b in bodies)
    with client.app.state.engine.connect() as conn:
        for table in ("users", "maps", "usage_events", "history_entries"):
            for row in conn.execute(text(f"SELECT * FROM {table}")):
                assert "SENTINELKEY000" not in repr(row), table


def test_redaction_filter_scrubs_messages_args_and_tracebacks():
    assert redact(f"key={SENTINEL_KEY} end") == "key=sk-ant-[REDACTED] end"
    record = logging.LogRecord("x", logging.ERROR, __file__, 1, "upstream said %s", (SENTINEL_KEY,), None)
    try:
        raise RuntimeError(f"boom {SENTINEL_KEY}")
    except RuntimeError:
        import sys
        record.exc_info = sys.exc_info()
    RedactKeysFilter().filter(record)
    assert "SENTINELKEY000" not in record.getMessage() and "SENTINELKEY000" not in record.exc_text


def test_proxy_headers_ignored_unless_trusted(build):
    client = build()
    for q in ("Population by country", "Average annual rainfall", "Life expectancy at birth"):
        make_map(client, q)
    client.cookies.clear()
    resp = client.post("/api/maps", json={"query": "Coffee"}, headers={**CSRF, "X-Forwarded-For": "203.0.113.9"})
    assert resp.status_code == 429  # a spoofed XFF doesn't buy a new IP identity


def test_trusted_proxy_header_sets_client_ip(build):
    client = build(trust_proxy_headers=True)
    for q in ("Population by country", "Average annual rainfall", "Life expectancy at birth"):
        client.post("/api/maps", json={"query": q}, headers={**CSRF, "X-Forwarded-For": "198.51.100.1"})
    client.cookies.clear()
    other = client.post("/api/maps", json={"query": "Coffee"}, headers={**CSRF, "X-Forwarded-For": "198.51.100.2"})
    assert other.status_code == 200
