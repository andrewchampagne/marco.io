"""Offline output-token benchmark: the old answer formats against the compact ones, no key, no spend.

Generation time is dominated by output tokens (each one is a decoding step), so fewer output tokens
for the same data is a direct speed-up. This counts them on the mock fixtures, which are real
per-country datasets, rendered the way the model writes them:

  main answer  old: every row [ISO3, value, confidence(, note)]
               new: [ISO3, value] when confidence is "h" (Row.from_list reads that as "h")
  gap fill     old: one {"iso3", "value", "confidence", "note"} object per asked country
               new: {"ISO3": [value(, confidence, note)] | null} keyed by code

Usage (from backend/): python -m bench.tokens [--missing 40]
Needs `pip install tiktoken`; o200k_base stands in for the model's own tokenizer, so treat the counts
as relative, not exact. Real timings need a key: python -m bench.run --strategies A.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).resolve().parents[1] / "app" / "llm" / "fixtures"


def compact(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def old_rows(rows: list[list[Any]]) -> list[list[Any]]:
    return [r if len(r) >= 3 else [*r, "h"] for r in rows]


def new_rows(rows: list[list[Any]]) -> list[list[Any]]:
    return [r[:2] if len(r) == 3 and r[2] == "h" else r for r in rows]


def gap_old(rows: list[list[Any]], nulls: int) -> dict[str, Any]:
    out = []
    for i, r in enumerate(rows):
        known = i >= nulls
        out.append({"iso3": r[0], "value": r[1] if known else None,
                    "confidence": (r[2] if len(r) > 2 else "h") if known else None,
                    "note": (r[3] if len(r) > 3 else None) if known else None})
    return {"rows": out}


def gap_new(rows: list[list[Any]], nulls: int) -> dict[str, Any]:
    return {"rows": {r[0]: (None if i < nulls else new_rows([r])[0][1:]) for i, r in enumerate(rows)}}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--missing", type=int, default=40, help="countries a gap fill asks about (default 40)")
    ap.add_argument("--nulls", type=int, default=8, help="of those, how many come back null (default 8)")
    args = ap.parse_args()
    try:
        import tiktoken
    except ImportError:
        raise SystemExit("pip install tiktoken first (dev-only; the app doesn't need it)") from None
    enc = tiktoken.get_encoding("o200k_base")

    def count(obj: Any) -> int:
        return len(enc.encode(compact(obj)))

    print(f"{'fixture':22} {'rows':>4} {'old':>6} {'new':>6} {'saved':>6}")
    old_total = new_total = 0
    for path in sorted(FIXTURES.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))["payload"]
        old = count({"meta": payload["meta"], "rows": old_rows(payload["rows"])})
        new = count({"meta": payload["meta"], "rows": new_rows(payload["rows"])})
        old_total, new_total = old_total + old, new_total + new
        print(f"{path.stem:22} {len(payload['rows']):>4} {old:>6} {new:>6} {1 - new / old:>6.0%}")
    print(f"{'main answer, all':22} {'':>4} {old_total:>6} {new_total:>6} {1 - new_total / old_total:>6.0%}")

    sample = json.loads((FIXTURES / "population.json").read_text(encoding="utf-8"))["payload"]["rows"][: args.missing]
    g_old, g_new = count(gap_old(sample, args.nulls)), count(gap_new(sample, args.nulls))
    print(f"\ngap fill, {len(sample)} countries ({args.nulls} null): old {g_old}  new {g_new}  saved {1 - g_new / g_old:.0%}")

    world = json.loads((FIXTURES / "population.json").read_text(encoding="utf-8"))["payload"]
    w_old = count({"meta": world["meta"], "rows": old_rows(world["rows"])}) + g_old
    w_new = count({"meta": world["meta"], "rows": new_rows(world["rows"])}) + g_new
    print(f"world map with gap fill (population): old {w_old}  new {w_new}  saved {1 - w_new / w_old:.0%}")


if __name__ == "__main__":
    main()
