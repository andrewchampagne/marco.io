"""Fetch World Bank ground truth for the benchmark's 'current statistic' and 'rate' queries.

No API key is needed (the World Bank API is public). Results are saved to bench/ground_truth/wb_<CODE>.json
and committed, so benchmark runs are reproducible and don't depend on the network for ground truth.

    cd backend && .venv/Scripts/python -m bench.fetch_ground_truth     (Windows)
    cd backend && .venv/bin/python -m bench.fetch_ground_truth         (macOS/Linux)
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
from pathlib import Path

from app.datasources.base import SourceMatch
from app.datasources.worldbank import CATALOG, WorldBankSource

HERE = Path(__file__).resolve().parent
GT_DIR = HERE / "ground_truth"


def wanted_codes() -> list[str]:
    queries = json.loads((HERE / "queries.json").read_text(encoding="utf-8"))
    return sorted({q["truth"][3:] for q in queries if (q.get("truth") or "").startswith("wb_")})


async def main() -> None:
    source = WorldBankSource(timeout=30)
    for code in wanted_codes():
        ind = next(i for i in CATALOG if i.code == code)
        result = await source.fetch(SourceMatch("worldbank", code, ind.title))
        rows = result.payload["rows"]
        body = {
            "id": f"wb_{code}",
            "title": f"{ind.metric_label} ({ind.unit})",
            "unit": ind.unit,
            "sources": [result.source["url"]],
            "fetched": dt.date.today().isoformat(),
            "time_scope": result.payload["meta"]["time_scope"],
            "values": {r[0]: r[1] for r in rows},
        }
        out = GT_DIR / f"wb_{code}.json"
        out.write_text(json.dumps(body, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"{code:22} {len(rows):3} countries  {result.latency_ms:5} ms  -> {out.name}")


if __name__ == "__main__":
    asyncio.run(main())
