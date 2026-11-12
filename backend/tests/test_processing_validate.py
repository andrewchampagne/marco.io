import json

import pytest

from app.config import DATA_DIR
from app.countries import load_countries
from app.processing import PayloadError, clean_payload, compute_stats, fill_all

COUNTRIES = load_countries()


def payload(rows, **meta):
    return {"meta": {"status": "ok", "title": "Test", **meta}, "rows": rows}


def test_unknown_iso_codes_are_dropped():
    cleaned = clean_payload(payload([["FRA", 1, "h"], ["XYZ", 2, "h"], ["SUNX", 3, "h"], [42, 4, "h"]]), COUNTRIES)
    assert [r.iso3 for r in cleaned.rows] == ["FRA"]
    assert cleaned.dropped == {"unknown_iso": 3}


def test_code_aliases_and_iso2_are_normalized():
    cleaned = clean_payload(payload([["rom", 1, "h"], ["KOS", 2, "h"], ["FR", 3, "h"], ["SUN", 4, "m"]]), COUNTRIES)
    assert [r.iso3 for r in cleaned.rows] == ["ROU", "XKX", "FRA", "RUS"]


def test_duplicates_keep_the_first_row():
    cleaned = clean_payload(payload([["FRA", 1, "h"], ["fra", 2, "h"], ["DDR", 5, "h"], ["DEU", 6, "h"]]), COUNTRIES)
    assert [(r.iso3, r.value) for r in cleaned.rows] == [("FRA", 1), ("DEU", 5)]
    assert cleaned.dropped == {"duplicate": 2}


def test_negative_values_need_allows_negative():
    rows = [["FRA", -2.5, "h"], ["DEU", 1.1, "h"]]
    assert [r.iso3 for r in clean_payload(payload(rows), COUNTRIES).rows] == ["DEU"]
    assert len(clean_payload(payload(rows, allows_negative=True), COUNTRIES).rows) == 2


def test_invalid_values_are_dropped_not_zeroed():
    rows = [["FRA", "n/a", "h"], ["DEU", None, "h"], ["ITA", float("nan"), "h"], ["ESP", 0, "h"]]
    cleaned = clean_payload(payload(rows), COUNTRIES)
    assert [(r.iso3, r.value) for r in cleaned.rows] == [("ESP", 0)]
    assert cleaned.dropped == {"invalid_value": 3}


def test_unmappable_and_categorical_and_empty():
    assert clean_payload({"meta": {"status": "unmappable", "reason": "chit-chat"}, "rows": []}, COUNTRIES).status == "unmappable"
    categorical = clean_payload(payload([["FRA", 1, "h"]], value_type="categorical"), COUNTRIES)
    assert categorical.status == "unmappable" and "categor" in categorical.meta.reason.lower()
    assert clean_payload(payload([["XYZ", 1, "h"]]), COUNTRIES).status == "empty"


@pytest.mark.parametrize("bad", [None, [], "text", {"rows": []}])
def test_non_payloads_raise(bad):
    with pytest.raises(PayloadError):
        clean_payload(bad, COUNTRIES)


def test_fill_all_covers_every_canonical_country_in_order():
    cleaned = clean_payload(payload([["FRA", 1, "h", "n"], ["DEU", 2, "m"]]), COUNTRIES)
    filled = fill_all(cleaned.rows, COUNTRIES)
    assert [r[0] for r in filled] == [c.iso3 for c in COUNTRIES.countries]
    by_code = {r[0]: r for r in filled}
    assert by_code["FRA"] == ["FRA", 1, "h", "n"]
    assert by_code["USA"] == ["USA", None, None, None]
    assert sum(1 for r in filled if r[1] is None) == len(COUNTRIES) - 2


def test_stats():
    stats = compute_stats([1, 2, 3, 10], total=5)
    assert stats == {"count": 4, "na_count": 1, "zero_count": 0, "total": 5, "min": 1, "max": 10, "median": 2.5, "mean": 4}
    assert compute_stats([0, 0, 3], total=5)["zero_count"] == 2
    assert compute_stats([], total=3)["na_count"] == 3


def test_dataset_files_are_in_sync_and_keyed():
    geo = json.loads((DATA_DIR / "countries.geojson").read_text(encoding="utf-8"))
    keys = [f["properties"]["iso3"] for f in geo["features"]]
    assert len(keys) == len(set(keys)) == len(COUNTRIES)
    assert keys == [c.iso3 for c in COUNTRIES.countries]
    assert all(len(k) == 3 and k.isalpha() and k.isupper() for k in keys)
    for must in ("FRA", "NOR", "XKX", "MCO", "SGP"):
        assert must in COUNTRIES.codes
