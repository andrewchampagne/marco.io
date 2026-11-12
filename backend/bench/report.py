"""Turn benchmark results (bench/results/*.jsonl) into tables inside docs/RETRIEVAL_BENCHMARK.md.

Only the block between the AUTO markers is rewritten; the analysis and decision around it are
hand-written. The newest results file of each mode (live, dry-run, c-only) is reported, live first.
"""

from __future__ import annotations

import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
DOC = HERE.parents[1] / "docs" / "RETRIEVAL_BENCHMARK.md"
START, END = "<!-- BENCH:AUTO:START -->", "<!-- BENCH:AUTO:END -->"
MODE_TITLES = {
    "live": "Live run (real API calls)",
    "c-only": "Strategy C only (World Bank, measured; no LLM)",
    "dry-run": "Dry run (mock model; checks the harness, numbers are not measurements)",
}


def _median(values: list[float]) -> float | None:
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else None


def _mean(values: list[float]) -> float | None:
    values = [v for v in values if v is not None]
    return statistics.fmean(values) if values else None


def _pct(values: list[float]) -> float | None:
    q = sorted(v for v in values if v is not None)
    return q[min(len(q) - 1, int(round(0.9 * (len(q) - 1))))] if q else None


def fmt(value: Any, kind: str = "") -> str:
    if value is None:
        return "–"
    if kind == "pct":
        return f"{value * 100:.0f}%"
    if kind == "usd":
        return f"${value:.5f}" if value < 0.01 else f"${value:.4f}"
    if kind == "int":
        return f"{value:,.0f}"
    if kind == "f2":
        return f"{value:.2f}"
    return str(value)


def summarize(records: list[dict[str, Any]]) -> list[str]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for r in records:
        if r.get("status") != "skipped":
            groups[(r["model"], r["strategy"])].append(r)
    lines = [
        "| Model | Strategy | Queries | Status correct | Valid output | Median ρ | Median coverage "
        "| Median MdAPE (WB) | In range (curated) | Warhead false +ves | Mean prompt tok | Mean output tok "
        "| Mean cost / map | Total cost | p50 latency | p90 latency | Searches |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for (model, strategy), rs in sorted(groups.items()):
        prompt = [(r.get("tokens_in") or 0) + (r.get("cache_read") or 0) + (r.get("cache_write") or 0) for r in rs]
        lat = [r.get("latency_ms") for r in rs]
        fp = [r["false_positives"] for r in rs if "false_positives" in r]
        lines.append("| " + " | ".join([
            model, strategy, str(len(rs)),
            fmt(_mean([float(r["status_ok"]) for r in rs if "status_ok" in r]), "pct"),
            fmt(_mean([float(r.get("valid", False)) for r in rs]), "pct"),
            fmt(_median([r.get("spearman") for r in rs]), "f2"),
            fmt(_median([r.get("coverage") for r in rs]), "pct"),
            fmt(_median([r.get("mdape") for r in rs]), "pct"),
            fmt(_mean([r.get("in_range") for r in rs]), "pct"),
            str(sum(fp)) if fp else "–",
            fmt(_mean(prompt), "int"),
            fmt(_mean([r.get("tokens_out") for r in rs]), "int"),
            fmt(_mean([r.get("cost_usd") for r in rs]), "usd"),
            fmt(sum(r.get("cost_usd") or 0 for r in rs), "usd"),
            fmt(_median(lat), "int") + " ms",
            fmt(_pct(lat), "int") + " ms",
            str(sum(r.get("searches") or 0 for r in rs)),
        ]) + " |")
    return lines


def detail(records: list[dict[str, Any]]) -> list[str]:
    lines = [
        "| Model | Strategy | Query | Type | Status | Rows | Coverage | ρ | MdAPE / in range | Out tok "
        "| Cost | Latency | Notes |",
        "|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for r in records:
        acc = fmt(r.get("mdape"), "pct") if "mdape" in r else fmt(r.get("in_range"), "pct")
        notes = []
        if r.get("matched"):
            notes.append(f"WB {r['matched']}")
        if r.get("fallback"):
            notes.append(f"fallback to {r['fallback']}")
        if r.get("salvaged"):
            notes.append("salvaged")
        if r.get("error"):
            notes.append(f"error: {r['error']}")
        if r.get("note"):
            notes.append(r["note"])
        if "false_positives" in r and r["false_positives"]:
            notes.append(f"{r['false_positives']} false +ve")
        status = r.get("status", "–") + ("" if r.get("status_ok", True) else " ✗")
        lines.append("| " + " | ".join([
            r["model"], r["strategy"], f"{r['query_id']}: {r['query'][:48]}", r["type"], status,
            fmt(r.get("rows")), fmt(r.get("coverage"), "pct"), fmt(r.get("spearman"), "f2"), acc,
            fmt(r.get("tokens_out"), "int"), fmt(r.get("cost_usd"), "usd"),
            fmt(r.get("latency_ms"), "int") + " ms" if r.get("latency_ms") is not None else "–",
            "; ".join(notes),
        ]) + " |")
    return lines


def latest_by_mode() -> dict[str, Path]:
    latest: dict[str, Path] = {}
    for path in sorted(RESULTS.glob("*.jsonl")):
        latest[path.stem[16:]] = path  # stem = YYYYmmdd-HHMMSS-<mode>
    return latest


def render() -> str:
    latest = latest_by_mode()
    parts = []
    if "live" not in latest:
        parts.append("> **No live run yet.** A/A+think/B accuracy and token figures need an API key: "
                     "`make bench` (or `python -m bench.run` in `backend/`) fills this in. "
                     "The sections below are the measured World Bank run and the harness dry run.\n")
    for mode in ("live", "c-only", "dry-run"):
        if mode not in latest:
            continue
        path = latest[mode]
        records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        when = path.stem[:15]
        parts.append(f"### {MODE_TITLES[mode]}\n\nResults file `{path.name}` ({when[:4]}-{when[4:6]}-{when[6:8]} "
                     f"{when[9:11]}:{when[11:13]}), {len(records)} records.\n")
        parts.append("\n".join(summarize(records)) + "\n")
        parts.append("<details><summary>Per-query results</summary>\n\n" + "\n".join(detail(records)) + "\n\n</details>\n")
    return "\n".join(parts)


def write_report() -> Path:
    block = f"{START}\n{render()}\n{END}"
    if DOC.exists():
        text = DOC.read_text(encoding="utf-8")
        if START in text and END in text:
            head, _, rest = text.partition(START)
            _, _, tail = rest.partition(END)
            DOC.write_text(head + block + tail, encoding="utf-8")
            return DOC
    DOC.parent.mkdir(parents=True, exist_ok=True)
    DOC.write_text("# Retrieval benchmark\n\n## Results\n\n" + block + "\n", encoding="utf-8")
    return DOC


if __name__ == "__main__":
    print(write_report())
