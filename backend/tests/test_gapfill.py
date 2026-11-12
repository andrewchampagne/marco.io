import json

from app.countries import load_countries
from app.llm.client import LLMError
from app.llm.contract import MapMeta
from app.llm.gapfill import anchors, gap_fill_input, gap_fill_schema, gap_rows, missing_sovereigns, should_fill
from app.llm.mock import MockMapGenerator

from .conftest import make_map

COUNTRIES = load_countries()
SOVEREIGN = [c.iso3 for c in COUNTRIES.countries if c.sovereign is None]
WORLD_QUERY = "Number of castles per country"  # a synthetic fixture covering most countries
WW1 = "How many deaths were there in each country in World War 1?"  # a fixture covering a few dozen


def test_only_world_scale_answers_are_filled_and_only_sovereign_gaps_are_asked():
    present = set(SOVEREIGN) - {"IND", "PAK", "KEN"}
    assert should_fill(present, COUNTRIES, 0.35) == [c for c in SOVEREIGN if c in {"IND", "PAK", "KEN"}]
    assert should_fill({"DNK", "NOR", "SWE"}, COUNTRIES, 0.35) == []  # regional answer: left alone
    assert "PRI" not in missing_sovereigns(set(), COUNTRIES)  # dependencies are never asked about


def test_gap_rows_keep_only_requested_non_null_answers():
    payload = {"rows": [
        {"iso3": "IND", "value": -45, "confidence": "m", "note": None},
        {"iso3": "PAK", "value": None, "confidence": None, "note": None},
        {"iso3": "USA", "value": 1, "confidence": "h", "note": None},  # not requested
        {"iso3": "IND", "value": 99, "confidence": "h", "note": None},  # duplicate: first wins
    ]}
    assert gap_rows(payload, ["IND", "PAK"]) == [["IND", -45, "m", None]]
    assert gap_rows(None, ["IND"]) == [] and gap_rows({"rows": "x"}, ["IND"]) == []


def test_request_carries_definition_anchors_and_names():
    meta = MapMeta(metric_label="Lowest recorded temperature", unit="°C", time_scope="all time")
    have = [[c, float(i)] for i, c in enumerate(SOVEREIGN[:50])]
    body = json.loads(gap_fill_input("coldest temperature", meta, have, ["IND"], COUNTRIES))
    assert body["unit"] == "°C" and body["countries_to_answer"] == ["IND India"]
    assert len(body["anchor_rows"]) == 12 and body["anchor_rows"][0][1] == 0 and body["anchor_rows"][-1][1] == 49
    assert gap_fill_schema(["IND"])["properties"]["rows"]["items"]["properties"]["iso3"]["enum"] == ["IND"]
    assert anchors([["A", 1]]) == [["A", 1]]


class Filling(MockMapGenerator):
    async def fill_gaps(self, query, meta, have, codes, countries, *, api_key=None, web_search=False):
        result = await super().fill_gaps(query, meta, have, codes, countries, api_key=api_key, web_search=web_search)
        result.payload = {"rows": [{"iso3": c, "value": 7, "confidence": "m", "note": "gap"} for c in codes[:2]]}
        return result


def test_gap_fill_adds_missing_countries_and_its_cost(build):
    client = build(generator=Filling(_settings(build)))
    _, name, data = make_map(client, WORLD_QUERY)
    assert name == "result"
    gen = client.app.state.generator
    asked = gen.gap_calls[0]
    filled = {r[0]: r for r in data["rows"] if r[0] in asked[:2]}
    assert all(r[1] == 7 and r[2] == "m" for r in filled.values()) and len(filled) == 2
    assert data["source"]["info"]["gap_fill"] == {"asked": len(asked), "added": 2}
    assert data["generation"]["tokens_out"] > 0


def test_no_gap_fill_for_regional_answers(build):
    client = build()
    make_map(client, WW1)
    assert getattr(client.app.state.generator, "gap_calls", []) == []


def test_gap_fill_failure_keeps_the_first_pass(build):
    class Broken(MockMapGenerator):
        async def fill_gaps(self, *args, **kwargs):
            raise LLMError("llm_unavailable", "down")

    client = build(generator=Broken(_settings(build)))
    _, name, data = make_map(client, WORLD_QUERY)
    assert name == "result" and data["stats"]["count"] > 0


def test_gap_fill_can_be_disabled(build):
    client = build(gap_fill_enabled=False)
    make_map(client, WORLD_QUERY)
    assert getattr(client.app.state.generator, "gap_calls", []) == []


def _settings(build):
    return build().app.state.settings
