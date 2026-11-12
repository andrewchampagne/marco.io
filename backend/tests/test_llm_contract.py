import json
import math

import pytest
from pydantic import ValidationError

from app.llm.contract import EMIT_MAP_TOOL, MAP_SCHEMA, META_SCHEMA, MapMeta, Row
from app.llm.jsonstream import MapStreamScanner, parse_map_json

UNSUPPORTED = {"prefixItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "multipleOf", "pattern"}


def _walk(schema):
    yield schema
    for value in schema.values():
        if isinstance(value, dict):
            yield from _walk(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    yield from _walk(item)


def test_schema_uses_only_structured_output_features():
    for node in _walk(MAP_SCHEMA):
        assert not (UNSUPPORTED & node.keys()), node
        if node.get("type") == "object":
            assert node.get("additionalProperties") is False
            assert set(node["required"]) == set(node["properties"])


def test_meta_comes_first_and_everything_is_required():
    assert list(MAP_SCHEMA["properties"]) == ["meta", "rows"]
    assert MAP_SCHEMA["required"] == ["meta", "rows"]
    assert META_SCHEMA["required"][0] == "status"
    assert EMIT_MAP_TOOL["strict"] is True and EMIT_MAP_TOOL["input_schema"] is MAP_SCHEMA


def test_union_typed_params_within_limit():
    unions = sum(1 for node in _walk(MAP_SCHEMA) if "anyOf" in node or isinstance(node.get("type"), list))
    assert unions <= 16


def test_meta_is_lenient():
    meta = MapMeta.model_validate({
        "status": "OK", "value_type": "weird", "higher_is": None, "suggested_scale": "LOG",
        "suggested_palette": "rainbow", "caveats": ["a", 3, "", "b", "c", "d"], "title": "x" * 500,
        "recency_sensitive": "yes",
    })
    assert meta.status == "ok"
    assert meta.value_type == "count"
    assert meta.higher_is == "neutral"
    assert meta.suggested_scale == "log"
    assert meta.suggested_palette == "verdant"
    assert meta.caveats == ["a", "b", "c"]
    assert len(meta.title) <= 90
    assert meta.recency_sensitive is True


@pytest.mark.parametrize(
    "raw,value,conf,note",
    [
        (["FRA", 1397800, "m"], 1397800, "m", None),
        (["FRA", "1,397,800", "high", "Includes colonies"], 1397800, "h", "Includes colonies"),
        (["DEU", "12.5%", "Low"], 12.5, "l", None),
        (["USA", 3, None, ""], 3, "l", None),
        (["GBR", 0, "h"], 0, "h", None),
    ],
)
def test_row_coercion(raw, value, conf, note):
    row = Row.from_list(raw)
    assert row.value == value and row.confidence == conf and row.note == note


@pytest.mark.parametrize("raw", [["FRA"], ["FRA", "about a million", "m"], ["FRA", True, "h"],
                                 ["FRA", None, "h"], ["FRA", math.nan, "h"], ["FRA", math.inf, "h"], "FRA"])
def test_row_rejects_bad_values(raw):
    with pytest.raises((ValidationError, ValueError)):
        Row.from_list(raw)


def test_note_is_clipped_to_80_chars():
    row = Row.from_list(["FRA", 1, "m", "word " * 40])
    assert len(row.note) <= 80


SAMPLE = {
    "meta": {"status": "ok", "title": "T", "caveats": ["has ] and [ brackets", "and \"quotes\""]},
    "rows": [["FRA", 1, "h", "note with ] bracket"], ["DEU", 2, "m"], ["ITA", 3, "l", "x\\\"y"]],
}


def test_scanner_counts_rows_across_arbitrary_chunks():
    text = json.dumps(SAMPLE)
    for size in (1, 3, 7, 50):
        scanner = MapStreamScanner()
        counts = [scanner.feed(text[i:i + size]) for i in range(0, len(text), size)]
        assert counts[-1] == 3
        assert counts == sorted(counts)
        payload, salvaged = scanner.result()
        assert payload == SAMPLE and not salvaged


def test_salvage_truncated_stream_keeps_complete_rows():
    text = json.dumps(SAMPLE)
    cut = text.index('["ITA"') + 8  # inside the third row
    payload, salvaged = parse_map_json(text[:cut])
    assert salvaged
    assert payload["meta"]["title"] == "T"
    assert payload["rows"] == SAMPLE["rows"][:2]


def test_salvage_with_rows_opened_but_none_complete():
    text = json.dumps(SAMPLE)
    payload, salvaged = parse_map_json(text[: text.index('["FRA"') + 4])
    assert salvaged and payload["rows"] == []


def test_truncated_inside_meta_cannot_be_salvaged():
    text = json.dumps(SAMPLE)
    assert parse_map_json(text[:20]) == (None, True)
