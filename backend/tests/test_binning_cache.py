import datetime as dt

import pytest

from app.binning import DEFAULT_CLASSES, ZERO_BIN, assign, compute_bins, compute_map_bins, legend
from app.cache import expires_at, normalize_query, query_hash


def counts(values, binning):
    return [e["count"] for e in legend(values, binning)]


def test_quantile_default_seven_classes_equal_counts():
    values = list(range(1, 71))
    b = compute_bins(values, "quantile", None)
    assert b.method == "quantile" and b.classes == DEFAULT_CLASSES and len(b.edges) == 8
    assert counts(values, b) == [10] * 7
    assert b.edges[0] == 1 and b.edges[-1] == 70


def test_equal_interval_edges_and_outlier():
    values = [0, 1, 2, 3, 4, 5, 1000]
    b = compute_bins(values, "equal", 5)
    assert b.edges == pytest.approx([0, 200, 400, 600, 800, 1000])
    assert counts(values, b) == [6, 0, 0, 0, 1]  # the outlier gets the top class alone


def test_log_bins_are_geometric_and_zeros_join_lowest():
    values = [0, 1, 10, 100, 1000, 10000]
    b = compute_bins(values, "log", 4)
    assert b.method == "log" and b.edges[0] == 0
    assert b.edges[1:] == pytest.approx([10, 100, 1000, 10000])
    assert assign(0, b) == 0 and assign(1, b) == 0 and assign(10000, b) == 3
    assert sum(counts(values, b)) == len(values)


def test_map_bins_give_zeros_their_own_class():
    values = [0, 0, 0, 5, 10, 20, 40]
    b = compute_map_bins(values, "equal", 3)
    assert b.zero_class and b.edges[0] == 5 and b.edges[-1] == 40
    assert assign(0, b) == ZERO_BIN and assign(5, b) == 0 and assign(40, b) == 2
    assert sum(counts(values, b)) == 4  # zeros are counted apart from the colour classes
    assert b.to_dict()["zero_class"] is True


@pytest.mark.parametrize("values", [[1, 2, 3], [0, 0, 0], [-1, 0, 2, 3]])
def test_map_bins_without_a_zero_class(values):
    b = compute_map_bins(values, "quantile", 3)
    assert not b.zero_class and all(assign(v, b) >= 0 for v in values)


def test_log_with_negatives_falls_back_to_quantile():
    b = compute_bins([-5, 1, 2, 3, 4, 50], "log", 5)
    assert b.method == "quantile" and b.requested_method == "log"
    assert "zero or more" in b.fallback_reason


def test_all_equal_values_make_one_class():
    b = compute_bins([7, 7, 7], "quantile", 7)
    assert b.classes == 1 and b.edges == [7, 7] and assign(7, b) == 0
    assert legend([7, 7, 7], b) == [{"min": 7, "max": 7, "count": 3}]


def test_single_value():
    b = compute_bins([42.0], "log", 5)
    assert b.classes == 1 and counts([42.0], b) == [1]


def test_heavy_ties_reduce_quantile_classes():
    values = [0] * 30 + [1, 2, 3]
    b = compute_bins(values, "quantile", 7)
    assert b.classes < 7 and b.fallback_reason
    assert sum(counts(values, b)) == len(values)


def test_outliers_with_quantile_keep_classes_populated():
    values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10_000_000]
    b = compute_bins(values, "quantile", 5)
    assert all(c > 0 for c in counts(values, b))


def test_classes_are_clamped_and_unknown_method_falls_back():
    assert compute_bins(list(range(100)), "equal", 50).classes == 9
    assert compute_bins(list(range(100)), "equal", 1).classes == 3
    b = compute_bins(list(range(100)), "bogus", 5)
    assert b.method == "quantile" and b.fallback_reason == "unknown method"


def test_top_edge_belongs_to_last_class():
    b = compute_bins([0, 10, 20, 30], "equal", 3)
    assert assign(30, b) == 2 and assign(10, b) == 1 and assign(9.999, b) == 0


@pytest.mark.parametrize("a,b", [
    ("How many deaths were there in each country in World War 1?", "how many deaths were there in each country in WWI"),
    ("Average annual rainfall by country", "average annual rainfall"),
    ("Show me a map of the population by country", "population"),
    ("CO₂ emissions per capita", "co2 emissions per capita"),
    ("  Life   expectancy!!  ", "life expectancy"),
    ("deaths in the second world war", "deaths in WW2"),
])
def test_normalization_merges_trivial_variants(a, b):
    assert normalize_query(a) == normalize_query(b)
    assert query_hash(normalize_query(a)) == query_hash(normalize_query(b))


@pytest.mark.parametrize("a,b", [
    ("population", "population density"),
    ("deaths in world war 1", "deaths in world war 2"),
    ("GDP per capita", "GDP"),
])
def test_normalization_keeps_different_questions_apart(a, b):
    assert normalize_query(a) != normalize_query(b)


def test_cache_ttl_depends_on_recency():
    now = dt.datetime(2026, 1, 1, tzinfo=dt.UTC)
    assert expires_at(True, ttl_days=30, recent_ttl_hours=24, now=now) == now + dt.timedelta(hours=24)
    assert expires_at(False, ttl_days=30, recent_ttl_hours=24, now=now) == now + dt.timedelta(days=30)
