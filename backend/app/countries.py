"""The canonical country list (data/countries.json), shared by the prompt, validation and the API."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .config import DATA_DIR

# Outdated, user-assigned or defunct codes a model might still emit, mapped to our keys.
# Defunct states map to their principal successor, matching rule 5 of the system prompt.
CODE_ALIASES = {
    "ROM": "ROU", "ZAR": "COD", "TMP": "TLS", "BUR": "MMR", "ANT": "CUW",
    "KOS": "XKX", "XKV": "XKX", "RKS": "XKX",
    "SUN": "RUS", "YUG": "SRB", "SCG": "SRB", "CSK": "CZE", "DDR": "DEU", "GDR": "DEU", "FRG": "DEU",
    "UK": "GBR", "EL": "GRC",
}
_CODE_RE = re.compile(r"^[A-Z]{2,3}$")


@dataclass(frozen=True)
class Country:
    iso3: str
    iso2: str | None
    name: str
    continent: str | None
    subregion: str | None
    sovereign: str | None
    tiny: bool


class CountryIndex:
    def __init__(self, countries: list[Country]):
        self.countries: tuple[Country, ...] = tuple(countries)
        self.codes: frozenset[str] = frozenset(c.iso3 for c in countries)
        self.by_iso3: dict[str, Country] = {c.iso3: c for c in countries}
        self._iso2: dict[str, str] = {c.iso2: c.iso3 for c in countries if c.iso2}

    def __len__(self) -> int:
        return len(self.countries)

    def normalize_code(self, raw: object) -> str | None:
        """Map a model-emitted code to a canonical ISO-3 key, or None if it isn't one of ours."""
        if not isinstance(raw, str):
            return None
        code = raw.strip().upper()
        if not _CODE_RE.match(code):
            return None
        if code in self.codes:
            return code
        if code in CODE_ALIASES:
            return CODE_ALIASES[code]
        if len(code) == 2:
            return self._iso2.get(code)
        return None


@lru_cache
def load_countries(path: Path = DATA_DIR / "countries.json") -> CountryIndex:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return CountryIndex(
        [
            Country(
                iso3=c["iso3"], iso2=c.get("iso2"), name=c["name"], continent=c.get("continent"),
                subregion=c.get("subregion"), sovereign=c.get("sovereign"), tiny=bool(c.get("tiny")),
            )
            for c in raw["countries"]
        ]
    )
