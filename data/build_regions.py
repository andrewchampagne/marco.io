"""Build data/regions.json (the focus regions) from data/countries.json.

    python data/build_regions.py

The output is committed, like countries.json, and read by both the backend (which countries a regional
question covers) and the frontend (the region picker, camera and dimming), so the two always agree.

Membership rules
* Continents follow Natural Earth's CONTINENT field, with two adjustments:
  - the four "Seven seas (open ocean)" islands go to the continent people file them under
    (Maldives -> Asia; Mauritius, Seychelles, Saint Helena -> Africa);
  - transcontinental countries belong to both continents they are commonly listed in
    (Russia: Europe and Asia; Turkey, Cyprus, Georgia, Armenia, Azerbaijan: Asia and Europe).
* Hemispheres use each country's representative point (`marker`, the centroid of its largest polygon), and
  also include a country whose main landmass (`bbox`) reaches more than 2 degrees across the dividing line,
  so Brazil, Indonesia and Kenya are in both the northern and southern hemispheres, and France and Algeria
  in both the eastern and western ones.

Each region also has a hand-set camera box ([west, south, east, north]) for the map.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
STRADDLE_DEG = 2.0

SEVEN_SEAS = {"MDV": "Asia", "MUS": "Africa", "SYC": "Africa", "SHN": "Africa"}
ALSO_IN = {
    "RUS": ["Asia"],
    "TUR": ["Europe"],
    "CYP": ["Europe"],
    "GEO": ["Europe"],
    "ARM": ["Europe"],
    "AZE": ["Europe"],
}

CONTINENTS = [
    # id, label, Natural Earth continent, camera box
    ("africa", "Africa", "Africa", [-19, -36, 53, 38]),
    ("asia", "Asia", "Asia", [26, -11, 148, 60]),
    ("europe", "Europe", "Europe", [-25, 34, 46, 71]),
    ("north-america", "North America", "North America", [-168, 6, -20, 76]),
    ("south-america", "South America", "South America", [-92, -56, -32, 13]),
    ("oceania", "Oceania", "Oceania", [110, -48, 180, 2]),
]

HEMISPHERES = [
    # id, label, test on (lon, lat), straddle test on bbox, camera box
    ("northern", "Northern Hemisphere", lambda lon, lat: lat >= 0, lambda b: b[3] > STRADDLE_DEG, [-168, -2, 180, 78]),
    ("southern", "Southern Hemisphere", lambda lon, lat: lat < 0, lambda b: b[1] < -STRADDLE_DEG, [-168, -56, 180, 4]),
    ("eastern", "Eastern Hemisphere", lambda lon, lat: lon >= 0, lambda b: b[2] > STRADDLE_DEG, [-20, -50, 180, 76]),
    ("western", "Western Hemisphere", lambda lon, lat: lon < 0, lambda b: b[0] < -STRADDLE_DEG, [-168, -56, 12, 78]),
]

WORLD_BOUNDS = [-168, -56, 180, 78]


def continent_of(country: dict) -> list[str]:
    base = SEVEN_SEAS.get(country["iso3"], country["continent"])
    return [base, *ALSO_IN.get(country["iso3"], [])]


def build(countries: list[dict]) -> dict:
    regions = [{
        "id": "world", "label": "Whole world", "short": "World", "group": "world",
        "members": [c["iso3"] for c in countries], "bounds": WORLD_BOUNDS,
    }]
    for rid, label, continent, bounds in CONTINENTS:
        members = [c["iso3"] for c in countries if continent in continent_of(c)]
        regions.append({"id": rid, "label": label, "short": label, "group": "continent", "members": members, "bounds": bounds})
    for rid, label, at, straddles, bounds in HEMISPHERES:
        members = [c["iso3"] for c in countries if at(*c["marker"]) or straddles(c["bbox"])]
        short = f"{label[0]}. Hemisphere"  # "N. Hemisphere": fits the search bar's region pill
        regions.append({"id": rid, "label": label, "short": short, "group": "hemisphere", "members": members, "bounds": bounds})
    return {
        "source": "data/build_regions.py from data/countries.json",
        "regions": regions,
    }


def main() -> None:
    countries = json.loads((HERE / "countries.json").read_text(encoding="utf-8"))["countries"]
    unplaced = [c["iso3"] for c in countries if continent_of(c)[0] not in {x[2] for x in CONTINENTS}]
    if unplaced:
        raise SystemExit(f"countries without a continent region: {unplaced}")
    out = build(countries)
    (HERE / "regions.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for r in out["regions"]:
        print(f"{r['id']:<14} {len(r['members']):>4} countries")


if __name__ == "__main__":
    main()
