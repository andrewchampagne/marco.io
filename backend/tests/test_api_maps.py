import json

from sqlalchemy import func, select

from app.countries import load_countries
from app.datasources.base import SourceMatch, SourceResult
from app.llm.client import LLMError
from app.llm.mock import MockMapGenerator
from app.models import HistoryEntry, Map, UsageEvent

from .conftest import CSRF, login, make_map, parse_sse

WW1 = "How many deaths were there in each country in World War 1?"


def used(client):
    return client.get("/api/usage").json()["used"]


def test_sse_stream_shape_and_result(client):
    resp = client.post("/api/maps", json={"query": WW1}, headers=CSRF)
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(resp.text)
    names = [n for n, _ in events]
    assert names[0] == "status" and names[-1] == "result"
    stages = [d["stage"] for n, d in events if n == "status"]
    assert stages == ["interpreting", "gathering", "building"]
    assert any(n == "progress" for n in names)
    result = events[-1][1]
    assert result["status"] == "ok" and result["meta"]["time_scope"] == "1914-1918"
    assert len(result["rows"]) == len(load_countries())  # every canonical country, N/A included
    na = [r for r in result["rows"] if r[1] is None]
    assert all(r[4] is None for r in na) and len(na) == result["stats"]["na_count"]
    assert sum(e["count"] for e in result["legend"]) == result["stats"]["count"]
    assert result["request"]["cached"] is False and result["request"]["tokens_out"] > 0
    assert result["usage"]["remaining"] == 2


def test_repeat_query_is_cached_with_zero_tokens_and_no_quota(build):
    client = build()
    gen = client.app.state.generator
    make_map(client, WW1)
    calls = gen.calls
    _, name, data = make_map(client, "how many deaths were there in each country in WWI")
    assert name == "result" and data["request"] == {"cached": True, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}
    assert gen.calls == calls and used(client) == 1


def test_fourth_free_attempt_is_429_with_reset_at(client):
    for q in ("Population by country", "Average annual rainfall", "Life expectancy at birth"):
        assert make_map(client, q)[1] == "result"
    resp, _, body = make_map(client, "Coffee consumption per person")
    assert resp.status_code == 429
    assert body["code"] == "quota_exceeded" and body["reset_at"] and body["signed_in"] is False


def test_clearing_cookies_does_not_reset_quota(client):
    for q in ("Population by country", "Average annual rainfall", "Life expectancy at birth"):
        make_map(client, q)
    client.cookies.clear()
    resp, _, body = make_map(client, "Coffee consumption per person")
    assert resp.status_code == 429 and body["code"] == "quota_exceeded"


def test_cache_hits_still_work_when_over_quota(client):
    for q in ("Population by country", "Average annual rainfall", "Life expectancy at birth"):
        make_map(client, q)
    resp, name, data = make_map(client, "population by country")
    assert resp.status_code == 200 and name == "result" and data["request"]["cached"]


def test_llm_errors_do_not_count(build):
    class Failing(MockMapGenerator):
        async def generate(self, query, **kw):
            raise LLMError("llm_unavailable", "down", retryable=True)

    client = build()
    client.app.state.generator = Failing(client.app.state.settings)
    _, name, data = make_map(client, WW1)
    assert name == "error" and data["code"] == "llm_unavailable" and data["retryable"]
    assert used(client) == 0
    with client.app.state.session_factory() as db:
        ev = db.scalars(select(UsageEvent)).one()
        assert ev.status == "error" and not ev.counted


def test_unmappable_counts_against_quota(client):
    _, name, data = make_map(client, "write me a poem about the sea")
    assert name == "result" and data["status"] == "unmappable" and data["meta"]["suggestions"]
    assert used(client) == 1


def test_budget_breaker_blocks_free_tier_but_not_byok(build):
    client = build(daily_budget_usd=0.0000001)
    assert make_map(client, WW1)[1] == "result"  # first call spends past the tiny budget
    resp, _, body = make_map(client, "Population by country")
    assert resp.status_code == 503 and body["code"] == "budget_exhausted"
    login(client)
    resp, name, _ = make_map(client, "Population by country", key="sk-ant-api03-" + "k" * 40)
    assert resp.status_code == 200 and name == "result"


def test_rebin_and_get_do_not_call_llm_or_use_quota(client):
    _, _, data = make_map(client, "Population by country")
    gen = client.app.state.generator
    calls, before = gen.calls, used(client)
    r = client.post(f"/api/maps/{data['slug']}/rebin", json={"method": "equal", "classes": 4}, headers=CSRF)
    assert r.status_code == 200
    body = r.json()
    assert body["binning"]["method"] == "equal" and body["binning"]["classes"] == 4
    assert len(body["bins"]) == len(load_countries()) and len(body["legend"]) == 4
    log_bins = client.post(f"/api/maps/{data['slug']}/rebin", json={"method": "log", "classes": 9}, headers=CSRF).json()
    assert log_bins["binning"]["method"] == "log" and log_bins["binning"]["classes"] == 9
    shared = client.get(f"/api/maps/{data['slug']}")
    assert shared.status_code == 200 and shared.json()["slug"] == data["slug"]
    assert gen.calls == calls and used(client) == before
    assert client.post(f"/api/maps/{data['slug']}/rebin", json={"classes": 12}, headers=CSRF).status_code == 400
    assert client.get("/api/maps/nope1234").json()["code"] == "map_not_found"


def test_query_validation(client):
    resp, _, body = make_map(client, "x" * 201)
    assert resp.status_code == 400 and body["code"] == "query_too_long"
    resp, _, body = make_map(client, " \x00\x07\t ")
    assert resp.status_code == 400 and body["code"] == "empty_query"
    _, name, data = make_map(client, "Population\x00 by\x1b country")
    assert name == "result" and data["query"] == "Population by country"


def test_in_flight_request_is_rejected(client):
    state = client.app.state
    client.get("/api/usage")  # mint the visitor cookie
    vid = state.keys.visitor.loads(client.cookies.get("tc_vid"))
    keys = [f"c:{state.keys.client_hash(vid)}"]
    assert state.inflight.acquire(keys)
    resp, _, body = make_map(client, WW1)
    assert resp.status_code == 409 and body["code"] == "in_flight"
    state.inflight.release(keys)
    assert make_map(client, WW1)[1] == "result"
    assert not state.inflight.busy(keys)  # released after the stream


def test_rate_limit_per_minute(build):
    client = build(rate_limit_per_minute=3)
    codes = [client.get("/api/examples").status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    r = client.get("/api/examples")
    assert r.json()["code"] == "rate_limited" and int(r.headers["retry-after"]) >= 1


def test_csrf_header_required_for_mutations(client):
    assert client.post("/api/maps", json={"query": WW1}).json()["code"] == "csrf"
    assert client.delete("/api/history").status_code == 403


def test_world_bank_tier_is_free_and_skips_llm(build):
    payload = {"meta": {"status": "ok", "title": "Population by Country", "unit": "people", "suggested_scale": "log",
                        "recency_sensitive": True, "caveats": ["Source: World Bank"]},
               "rows": [["FRA", 68_000_000, "h"], ["DEU", 84_000_000, "h"], ["ITA", 59_000_000, "h"]]}

    class FakeSource:
        name = "fake"

        def match(self, query):
            return SourceMatch("fake", "SP.POP.TOTL", "Population") if "population" in query.lower() else None

        async def fetch(self, match):
            return SourceResult(payload=payload, source={"name": "World Bank", "indicator": "SP.POP.TOTL",
                                                         "url": "https://data.worldbank.org"}, latency_ms=5)

    client = build(datasources_enabled=True, datasources=[FakeSource()])
    gen = client.app.state.generator
    _, name, data = make_map(client, "Population by country")
    assert name == "result" and data["source"]["kind"] == "worldbank" and data["source"]["strategy"] == "C"
    assert gen.calls == 0 and used(client) == 0
    assert data["source"]["info"]["indicator"] == "SP.POP.TOTL"


def test_history_lists_and_clears_without_resetting_quota(client):
    make_map(client, WW1)
    make_map(client, "Population by country")
    items = client.get("/api/history").json()["items"]
    assert [i["query"] for i in items] == ["Population by country", WW1]
    assert client.delete("/api/history", headers=CSRF).json()["deleted"] == 2
    assert client.get("/api/history").json()["items"] == [] and used(client) == 2


def test_export_contains_history_but_no_secrets(client):
    make_map(client, WW1)
    r = client.get("/api/me/export")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    body = r.json()
    assert body["account"] is None and body["history"][0]["query"] == WW1
    text = json.dumps(body)
    assert "ip_hash" not in text and "client_hash" not in text


def test_examples_and_config(client):
    ex = client.get("/api/examples").json()
    assert len(ex["chips"]) >= 4 and len(ex["placeholders"]) >= 5
    cfg = client.get("/api/config").json()
    assert cfg["llm_mode"] == "mock" and cfg["auth_mode"] == "mock" and cfg["free_maps_per_day"] == 3


def test_salvaged_output_gets_a_caveat(build):
    from app.llm.client import LLMResult, Usage

    class Truncating(MockMapGenerator):
        async def generate(self, query, **kw):
            return LLMResult(payload={"meta": {"status": "ok", "title": "T", "caveats": []},
                                      "rows": [["FRA", 1, "h"], ["DEU", 2, "h"]]},
                             usage=Usage(input_tokens=10, output_tokens=4000), cost_usd=0.002, model="m",
                             strategy="A", stop_reason="max_tokens", salvaged=True)

    client = build()
    client.app.state.generator = Truncating(client.app.state.settings)
    _, name, data = make_map(client, "Something long")
    assert name == "result" and any("cut off" in c for c in data["meta"]["caveats"])


def test_empty_result_is_an_uncounted_error(build):
    from app.llm.client import LLMResult, Usage

    class Empty(MockMapGenerator):
        async def generate(self, query, **kw):
            return LLMResult(payload={"meta": {"status": "ok", "title": "T"}, "rows": [["XYZ", 1, "h"]]},
                             usage=Usage(input_tokens=10, output_tokens=20), cost_usd=0.001, model="m",
                             strategy="A", stop_reason="end_turn")

    client = build()
    client.app.state.generator = Empty(client.app.state.settings)
    _, name, data = make_map(client, "Something")
    assert name == "error" and data["code"] == "no_data"
    assert used(client) == 0
    with client.app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(Map)) == 0
        assert db.scalar(select(UsageEvent.cost_est)) == 0.001  # the spend still counts toward the budget
