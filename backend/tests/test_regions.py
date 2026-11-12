from app.countries import load_countries
from app.llm.gapfill import should_fill
from app.llm.prompt import system_prompt, user_turn
from app.regions import load_regions

from .conftest import CSRF, KEY, parse_sse

REGIONS = load_regions()
COUNTRIES = load_countries()
WORLD_QUERY = "Number of castles per country"  # synthetic fixture covering most countries


def make_region_map(client, query, region, key=KEY):
    headers = {**CSRF, "X-OpenAI-Key": key}
    resp = client.post("/api/maps", json={"query": query, "region": region}, headers=headers)
    if resp.headers.get("content-type", "").startswith("text/event-stream"):
        events = parse_sse(resp.text)
        return resp, events
    return resp, None


def test_every_country_has_a_continent_and_a_hemisphere():
    continents = [r for r in REGIONS.regions if r.group == "continent"]
    for c in COUNTRIES.countries:
        assert any(c.iso3 in r.members for r in continents), c.iso3
        assert c.iso3 in REGIONS.get("northern").members or c.iso3 in REGIONS.get("southern").members
        assert c.iso3 in REGIONS.get("eastern").members or c.iso3 in REGIONS.get("western").members
    assert len(REGIONS.get("world").members) == len(COUNTRIES)


def test_transcontinental_and_straddling_countries():
    europe, asia = REGIONS.get("europe").members, REGIONS.get("asia").members
    assert {"RUS", "TUR", "CYP", "GEO"} <= europe and {"RUS", "TUR"} <= asia
    assert "MDV" in asia and "MUS" in REGIONS.get("africa").members  # Natural Earth's "Seven seas" islands
    assert "BRA" in REGIONS.get("northern").members and "BRA" in REGIONS.get("southern").members
    assert "USA" in REGIONS.get("western").members and "USA" not in REGIONS.get("eastern").members


def test_unknown_region_is_rejected(client):
    resp, _ = make_region_map(client, WORLD_QUERY, "atlantis")
    assert resp.status_code == 400 and resp.json()["code"] == "invalid_region"


def test_region_map_keeps_only_its_countries_and_counts_no_data_within_it(client):
    _, events = make_region_map(client, WORLD_QUERY, "europe")
    name, data = events[-1]
    assert name == "result" and data["region"] == "europe"
    europe = REGIONS.get("europe").members
    with_values = [r[0] for r in data["rows"] if r[1] is not None]
    assert with_values and set(with_values) <= europe
    assert data["stats"]["total"] == len(europe)
    assert data["stats"]["count"] + data["stats"]["na_count"] == len(europe)
    assert client.app.state.generator.regions[-1] == "europe"
    assert any(e == ("status", {"stage": "gathering", "message": "Gathering data for Europe"}) for e in events)


def test_cache_is_per_region(client):
    gen = client.app.state.generator
    make_region_map(client, WORLD_QUERY, "world")
    _, events = make_region_map(client, WORLD_QUERY, "europe")
    assert not events[-1][1]["request"]["cached"] and gen.calls == 2
    _, events = make_region_map(client, WORLD_QUERY, "europe")
    assert events[-1][1]["request"]["cached"] and gen.calls == 2


def test_history_and_saved_maps_carry_the_region(client):
    _, events = make_region_map(client, WORLD_QUERY, "asia")
    slug = events[-1][1]["slug"]
    assert client.get(f"/api/maps/{slug}").json()["region"] == "asia"
    assert client.get("/api/history").json()["items"][0]["region"] == "asia"


def test_region_goes_in_the_user_turn_and_the_cached_prompt_is_unchanged():
    before = system_prompt()
    plain = user_turn("coffee", region=REGIONS.get("world"))
    scoped = user_turn("coffee", region=REGIONS.get("south-america"))
    assert "<focus_region>" not in plain
    assert "<focus_region>South America</focus_region>" in scoped and "BRA Brazil" in scoped and "FRA" not in scoped
    assert system_prompt() == before


def test_gap_fill_is_scoped_to_the_region():
    africa = REGIONS.get("africa").members
    sovereign_africa = [c.iso3 for c in COUNTRIES.countries if c.sovereign is None and c.iso3 in africa]
    present = set(sovereign_africa) - {"KEN", "ETH"}
    assert should_fill(present, COUNTRIES, 0.35, scope=africa) == [c for c in sovereign_africa if c in {"KEN", "ETH"}]
    # The same answer is far too small a share of the world to be filled as a world map.
    assert should_fill(present, COUNTRIES, 0.35) == []
