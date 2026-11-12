"""Focus regions (data/regions.json, built by data/build_regions.py), shared with the frontend.

A map is made for one region: "world" (every country) or a continent or hemisphere. The region decides
which countries the AI is asked about, which rows are kept, what the gap-fill pass checks, and how many
countries count as "no data".
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .config import DATA_DIR
from .errors import ApiError

WORLD = "world"


@dataclass(frozen=True)
class Region:
    id: str
    label: str
    group: str  # world | continent | hemisphere
    members: frozenset[str]
    order: tuple[str, ...]  # members in canonical country order

    @property
    def is_world(self) -> bool:
        return self.id == WORLD


class RegionIndex:
    def __init__(self, regions: list[Region]):
        self.by_id = {r.id: r for r in regions}
        self.regions = tuple(regions)

    def get(self, region_id: str | None) -> Region:
        """The region for an id from a request; unknown ids are a 400."""
        region = self.by_id.get(region_id or WORLD)
        if region is None:
            raise ApiError(400, "invalid_region", "Unknown region. Pick one from the region list.")
        return region

    def resolve(self, region_id: str | None) -> Region:
        """The region a stored map belongs to (older maps, or ids since removed, fall back to world)."""
        return self.by_id.get(region_id or WORLD) or self.by_id[WORLD]


@lru_cache
def load_regions(path: Path = DATA_DIR / "regions.json") -> RegionIndex:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return RegionIndex([
        Region(id=r["id"], label=r["label"], group=r["group"], members=frozenset(r["members"]), order=tuple(r["members"]))
        for r in raw["regions"]
    ])
