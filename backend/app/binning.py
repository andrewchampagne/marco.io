"""Class breaks for the choropleth, always computed here and never taken from the model.

Methods:
  quantile  equal-count classes; the default for skewed data. Duplicate edges are merged, so heavily
            tied data can end up with fewer classes than requested.
  equal     equal-width intervals between min and max (the model's "linear").
  log       geometric intervals between the smallest positive value and max. Zeros join the lowest
            class. Negative values make it invalid, and then it falls back to quantile.

The API returns bin *indices* per country plus legend entries, so the client can recolor instantly
for any palette.

Zero class: when a map's values are all >= 0 and some are exactly 0, `compute_map_bins` bins only the
positive values and gives zeros their own class (bin index ZERO_BIN), so a documented zero never
shares a colour with small positive values and never looks like "no data" (bin index None).
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import asdict, dataclass

METHODS = ("quantile", "equal", "log")
MIN_CLASSES, MAX_CLASSES, DEFAULT_CLASSES = 3, 9, 7
SCALE_TO_METHOD = {"linear": "equal", "log": "log", "quantile": "quantile"}
ZERO_BIN = -2  # bin index for exact zeros when the zero class is on (None stays "no data")


@dataclass
class Binning:
    method: str  # the method actually used
    requested_method: str
    classes: int  # effective number of classes
    requested_classes: int
    edges: list[float]  # classes + 1 ascending edges; bins are [e_i, e_i+1), the last is closed
    fallback_reason: str | None = None
    zero_class: bool = False  # zeros sit outside the edges in their own class (ZERO_BIN)

    def to_dict(self) -> dict:
        return asdict(self)


def clamp_classes(classes: int | None) -> int:
    if classes is None:
        return DEFAULT_CLASSES
    return max(MIN_CLASSES, min(MAX_CLASSES, int(classes)))


def method_for_scale(scale: str | None) -> str:
    return SCALE_TO_METHOD.get(scale or "", "quantile")


def _quantile(sorted_values: list[float], q: float) -> float:
    """Linear-interpolated quantile (the 'inclusive' definition)."""
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = q * (len(sorted_values) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def _dedupe(edges: list[float]) -> list[float]:
    out: list[float] = []
    for e in edges:
        if not out or e > out[-1]:
            out.append(e)
    return out


def compute_bins(values: list[float], method: str | None, classes: int | None) -> Binning:
    requested_method = method if method in METHODS else "quantile"
    requested_classes = clamp_classes(classes)
    k = requested_classes
    if not values:
        return Binning(requested_method, requested_method, 0, k, [], "no data")
    vals = sorted(values)
    lo, hi = vals[0], vals[-1]
    if lo == hi:
        return Binning(requested_method, requested_method, 1, k, [lo, hi], "all values are equal")

    fallback = None if method in METHODS else ("unknown method" if method else None)
    chosen = requested_method
    if chosen == "log":
        positives = [v for v in vals if v > 0]
        if lo < 0:
            chosen, fallback = "quantile", "log scale needs values of zero or more"
        elif len(set(positives)) < 2:
            chosen, fallback = "quantile", "not enough distinct positive values for a log scale"

    if chosen == "equal":
        step = (hi - lo) / k
        edges = [lo + i * step for i in range(k)] + [hi]
    elif chosen == "log":
        p_lo = min(v for v in vals if v > 0)
        ratio = hi / p_lo
        edges = [p_lo * ratio ** (i / k) for i in range(k)] + [hi]
        if lo == 0:
            edges[0] = 0.0
    else:
        k_eff = min(k, len(set(vals)))
        edges = _dedupe([_quantile(vals, i / k_eff) for i in range(k_eff + 1)])
        if len(edges) - 1 < k and fallback is None:
            fallback = "too many tied values for that many quantile classes"
    return Binning(chosen, requested_method, len(edges) - 1, requested_classes, edges, fallback)


def compute_map_bins(values: list[float], method: str | None, classes: int | None) -> Binning:
    """`compute_bins` for a map: exact zeros get their own class when every value is >= 0 and at
    least one is positive; the colour classes then cover only the positive values."""
    positives = [v for v in values if v > 0]
    if positives and len(positives) < len(values) and min(values) == 0:
        binning = compute_bins(positives, method, classes)
        binning.zero_class = True
        return binning
    return compute_bins(values, method, classes)


def assign(value: float, binning: Binning) -> int:
    """Index of the class containing `value` (the top edge belongs to the last class)."""
    if binning.zero_class and value == 0:
        return ZERO_BIN
    if binning.classes <= 1:
        return 0
    idx = bisect_right(binning.edges, value) - 1
    return max(0, min(binning.classes - 1, idx))


def legend(values: list[float], binning: Binning) -> list[dict]:
    counts = [0] * max(binning.classes, 0)
    for v in values:
        if binning.zero_class and v == 0:
            continue  # counted in stats.zero_count, not in a colour class
        if counts:
            counts[assign(v, binning)] += 1
    return [
        {"min": binning.edges[i], "max": binning.edges[i + 1], "count": counts[i]}
        for i in range(binning.classes)
    ]
