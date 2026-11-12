"""Accuracy metrics for one predicted map against ground truth.

Ground truth comes in two shapes:
  * exact values (World Bank): {ISO3: value}, scored with absolute percentage error;
  * ranges (curated history/rankings): {ISO3: [low, high]}, scored by whether the prediction falls
    inside the range (widened by 10%), with ranks taken from the range midpoints.

Spearman rank correlation matters most, because a choropleth's bins depend on ordering, not exact values.
"""

from __future__ import annotations

import statistics
from typing import Any


def _ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def spearman(xs: list[float], ys: list[float]) -> float | None:
    """Spearman's rho with average ranks for ties; None below 5 pairs or with zero variance."""
    if len(xs) != len(ys) or len(xs) < 5:
        return None
    rx, ry = _ranks(xs), _ranks(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    vx = sum((a - mx) ** 2 for a in rx)
    vy = sum((b - my) ** 2 for b in ry)
    if vx == 0 or vy == 0:
        return None
    return cov / (vx * vy) ** 0.5


def evaluate(pred: dict[str, float], truth: dict[str, Any], *, exclusive: bool = False) -> dict[str, Any]:
    is_range = any(isinstance(v, list) for v in truth.values())
    common = sorted(pred.keys() & truth.keys())
    extras = sorted(pred.keys() - truth.keys())
    out: dict[str, Any] = {
        "truth_n": len(truth),
        "pred_n": len(pred),
        "coverage": round(len(common) / len(truth), 3) if truth else None,
        "extras": len(extras),
    }
    if is_range:
        mids = {k: (v[0] + v[1]) / 2 for k, v in truth.items()}
        inside = [truth[k][0] * 0.9 <= pred[k] <= truth[k][1] * 1.1 for k in common]
        out["in_range"] = round(sum(inside) / len(inside), 3) if inside else None
        rho = spearman([pred[k] for k in common], [mids[k] for k in common])
    else:
        apes = [abs(pred[k] - truth[k]) / abs(truth[k]) for k in common if truth[k] != 0]
        out["mdape"] = round(statistics.median(apes), 4) if apes else None
        out["within25"] = round(sum(a <= 0.25 for a in apes) / len(apes), 3) if apes else None
        rho = spearman([pred[k] for k in common], [truth[k] for k in common])
    out["spearman"] = round(rho, 3) if rho is not None else None
    if exclusive:
        out["false_positives"] = sum(1 for k in extras if pred[k] > 0)
    return out
