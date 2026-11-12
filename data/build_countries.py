"""Build Terrachrome's country dataset from Natural Earth (public domain).

Outputs are committed, so a fresh clone never needs to run this script:

  data/countries.geojson   polygons keyed by `iso3`; properties stripped, coordinates quantized
  data/countries.json      the canonical country list: used verbatim in the LLM system prompt,
                           for backend validation, and by the UI (names, search aliases, markers)

Both files come from the same features, so the prompt's country list and the map polygons
always match 1:1. The build fails loudly if any feature lacks a valid, unique ISO-3 key.

Usage:
    python -I data/build_countries.py            # uses data/.cache/ if present, else downloads
    python -I data/build_countries.py --refresh  # force a fresh download
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.request
from pathlib import Path

NE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
    "geojson/ne_50m_admin_0_countries.geojson"
)
HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "ne_50m_admin_0_countries.geojson"
OUT_GEOJSON = HERE / "countries.geojson"
OUT_JSON = HERE / "countries.json"

PRECISION = 3  # decimal degrees, ~110 m: far finer than the 1:50m source
TINY_AREA_KM2 = 12_000  # below this a country gets a hoverable centroid marker
ISO3_RE = re.compile(r"^[A-Z]{3}$")

# Uninhabited or research-only territories with no meaningful country-level statistics.
DROP = {
    "ATA": "Antarctica",
    "ATF": "French Southern and Antarctic Lands",
    "HMD": "Heard Island and McDonald Islands",
    "SGS": "South Georgia and the South Sandwich Islands",
    "IOT": "British Indian Ocean Territory",
}

# Natural Earth features without an ISO code, keyed by ADM0_A3, merged into the polity that
# administers them. This matches how country-level datasets (UN, World Bank, IMF) report them.
MERGE_INTO = {
    "SOL": "SOM",  # Somaliland -> Somalia
    "CYN": "CYP",  # Northern Cyprus -> Cyprus
    "KAS": "IND",  # Siachen Glacier -> India (de facto administration)
}
# Indian Ocean Territories and Ashmore and Cartier Islands already carry ISO_A3_EH=AUS,
# so they merge into Australia through the duplicate-key path below.

# Kosovo has no ISO 3166 code; XKX is the user-assigned code used by the EU, IMF and World Bank.
RENAME_KEY = {"KOS": "XKX"}

# Display names. Natural Earth NAME_EN is a good default; these read better on a map.
NAME_OVERRIDES = {
    "USA": "United States",
    "CHN": "China",
    "CZE": "Czechia",
    "TLS": "Timor-Leste",
    "CIV": "Côte d'Ivoire",
    "CPV": "Cabo Verde",
    "MAC": "Macao",
    "GMB": "Gambia",
    "BHS": "Bahamas",
    "FSM": "Micronesia",
    "XKX": "Kosovo",
    "VAT": "Vatican City",
    "COD": "DR Congo",
    "COG": "Republic of the Congo",
}

EXTRA_ALIASES = {
    "USA": ["US", "USA", "America", "United States of America"],
    "GBR": ["UK", "Britain", "Great Britain"],
    "NLD": ["Holland"],
    "MMR": ["Burma"],
    "SWZ": ["Swaziland"],
    "CZE": ["Czech Republic"],
    "TUR": ["Türkiye", "Turkiye"],
    "COD": ["Democratic Republic of the Congo", "Congo-Kinshasa", "DRC"],
    "COG": ["Congo-Brazzaville", "Congo"],
    "CIV": ["Ivory Coast"],
    "TLS": ["East Timor"],
    "CPV": ["Cape Verde"],
    "MKD": ["Macedonia"],
    "KOR": ["Korea, South", "Republic of Korea"],
    "PRK": ["Korea, North", "DPRK"],
    "ARE": ["UAE", "Emirates"],
    "VAT": ["Holy See"],
}

# Natural Earth sovereignty codes -> ISO-3 of the sovereign state (for dependencies only).
SOVEREIGN_ISO = {
    "AU1": "AUS", "GB1": "GBR", "FR1": "FRA", "US1": "USA", "NL1": "NLD", "DN1": "DNK",
    "NZ1": "NZL", "FI1": "FIN", "CH1": "CHN",
}

KM_PER_DEG_LAT = 110.574
KM_PER_DEG_LON_EQ = 111.320


def fail(msg: str) -> None:
    print(f"build_countries: ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def load_source(refresh: bool) -> dict:
    if refresh or not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {NE_URL}")
        with urllib.request.urlopen(NE_URL, timeout=60) as resp:  # noqa: S310 (fixed https URL)
            CACHE.write_bytes(resp.read())
    return json.loads(CACHE.read_text(encoding="utf-8"))


def resolve_key(props: dict) -> str:
    adm = props.get("ADM0_A3") or ""
    if adm in MERGE_INTO:
        return MERGE_INTO[adm]
    eh = props.get("ISO_A3_EH") or ""
    key = eh if ISO3_RE.match(eh) else adm
    return RENAME_KEY.get(key, key)


def polygons_of(geometry: dict) -> list[list[list[list[float]]]]:
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return list(geometry["coordinates"])
    fail(f"unexpected geometry type {geometry['type']}")
    return []


def quantize_ring(ring: list[list[float]]) -> list[list[float]] | None:
    out: list[list[float]] = []
    for lon, lat, *_ in ring:
        pt = [round(lon, PRECISION), round(lat, PRECISION)]
        if not out or pt != out[-1]:
            out.append(pt)
    if out and out[0] != out[-1]:
        out.append(out[0])
    # A valid linear ring needs 4 positions (3 distinct + closing).
    if len(out) < 4 or len({tuple(p) for p in out}) < 3:
        return None
    return out


def quantize_polygon(poly: list[list[list[float]]]) -> list[list[list[float]]] | None:
    outer = quantize_ring(poly[0])
    if outer is None:
        return None
    holes = [h for h in (quantize_ring(r) for r in poly[1:]) if h is not None]
    return [outer, *holes]


def ring_area_centroid(ring: list[list[float]]) -> tuple[float, float, float]:
    """Approximate area (km^2) and centroid (lon, lat) on a local equirectangular projection."""
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx = KM_PER_DEG_LON_EQ * math.cos(math.radians(lat0))
    ky = KM_PER_DEG_LAT
    a2 = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        x1k, y1k, x2k, y2k = x1 * kx, y1 * ky, x2 * kx, y2 * ky
        cross = x1k * y2k - x2k * y1k
        a2 += cross
        cx += (x1k + x2k) * cross
        cy += (y1k + y2k) * cross
    if abs(a2) < 1e-12:
        return 0.0, ring[0][0], ring[0][1]
    area = a2 / 2.0
    return abs(area), (cx / (6.0 * area)) / kx, (cy / (6.0 * area)) / ky


def polygon_area(poly: list[list[list[float]]]) -> float:
    area, _, _ = ring_area_centroid(poly[0])
    return max(0.0, area - sum(ring_area_centroid(h)[0] for h in poly[1:]))


def bbox_of(polys: list[list[list[list[float]]]]) -> list[float]:
    xs = [p[0] for poly in polys for p in poly[0]]
    ys = [p[1] for poly in polys for p in poly[0]]
    return [min(xs), min(ys), max(xs), max(ys)]


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def fly_bbox(polys: list, areas: list[float], centroids: list[tuple[float, float]]) -> list[float]:
    """A camera box for "fly to country": the main landmass plus nearby large islands.

    Skips far-flung territories (French Guiana for France, Alaska for the US) and falls back to the
    largest polygon when the selection straddles the antimeridian (Russia, Fiji, Kiribati).
    """
    i_max = max(range(len(polys)), key=lambda i: areas[i])
    keep = [
        polys[i]
        for i in range(len(polys))
        if i == i_max
        or (areas[i] >= 0.10 * areas[i_max] and haversine_km(centroids[i], centroids[i_max]) <= 3500)
    ]
    box = bbox_of(keep)
    if box[2] - box[0] > 180:
        box = bbox_of([polys[i_max]])
    return [round(v, 2) for v in box]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--refresh", action="store_true", help="re-download the Natural Earth source")
    args = ap.parse_args()

    src = load_source(args.refresh)
    groups: dict[str, dict] = {}
    for feat in src["features"]:
        props = feat["properties"]
        key = resolve_key(props)
        if key in DROP:
            continue
        group = groups.setdefault(key, {"primary": None, "polys": []})
        # The primary feature (names, region, sovereignty) is the one whose own code is the key.
        own = RENAME_KEY.get(props.get("ADM0_A3"), props.get("ADM0_A3"))
        if group["primary"] is None or own == key:
            group["primary"] = props
        group["polys"].extend(polygons_of(feat["geometry"]))

    features, countries = [], []
    for key in sorted(groups):
        if not ISO3_RE.match(key):
            fail(f"feature has no valid ISO-3 key: {key!r}")
        group = groups[key]
        props = group["primary"]
        polys = [q for q in (quantize_polygon(p) for p in group["polys"]) if q is not None]
        if not polys:
            fail(f"{key}: every polygon degenerated during quantization")
        areas = [polygon_area(p) for p in polys]
        centroids = [ring_area_centroid(p[0])[1:] for p in polys]
        i_max = max(range(len(polys)), key=lambda i: areas[i])
        total_area = sum(areas)

        name = NAME_OVERRIDES.get(key) or props.get("NAME_EN") or props.get("NAME")
        sov = SOVEREIGN_ISO.get(props.get("SOV_A3") or "")
        is_dependency = props.get("TYPE") in ("Dependency", "Country") and sov and sov != key
        iso2 = props.get("ISO_A2_EH") or props.get("ISO_A2") or ""
        if key == "XKX":
            iso2 = "XK"
        aliases: list[str] = []
        for cand in [
            props.get("NAME"), props.get("NAME_EN"), props.get("NAME_LONG"), props.get("ADMIN"),
            props.get("FORMAL_EN"), *EXTRA_ALIASES.get(key, []),
        ]:
            if cand and cand != name and cand not in aliases:
                aliases.append(cand)

        countries.append({
            "iso3": key,
            "iso2": iso2 if re.match(r"^[A-Z]{2}$", iso2) else None,
            "name": name,
            "aliases": aliases,
            "continent": props.get("CONTINENT"),
            "subregion": props.get("SUBREGION"),
            "sovereign": sov if is_dependency else None,
            "area_km2": round(total_area),
            "tiny": total_area < TINY_AREA_KM2,
            "marker": [round(centroids[i_max][0], 3), round(centroids[i_max][1], 3)],
            "bbox": fly_bbox(polys, areas, centroids),
        })
        geometry = (
            {"type": "Polygon", "coordinates": polys[0]}
            if len(polys) == 1
            else {"type": "MultiPolygon", "coordinates": polys}
        )
        features.append({"type": "Feature", "properties": {"iso3": key, "name": name}, "geometry": geometry})

    # --- validation: every polygon keyed, keys unique, both files 1:1 ---
    keys = [f["properties"]["iso3"] for f in features]
    if len(keys) != len(set(keys)):
        fail("duplicate keys in output")
    if keys != [c["iso3"] for c in countries]:
        fail("GeoJSON and canonical list are out of sync")
    for must in ("FRA", "NOR", "XKX", "SOM", "CYP", "AUS", "MCO", "SGP", "MDV", "VAT"):
        if must not in keys:
            fail(f"expected key {must} missing")

    OUT_GEOJSON.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    OUT_JSON.write_text(
        json.dumps(
            {
                "source": "Natural Earth 1:50m Admin 0 - Countries (public domain), via data/build_countries.py",
                "count": len(countries),
                "countries": countries,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    tiny = [c["iso3"] for c in countries if c["tiny"]]
    print(f"{len(features)} countries -> {OUT_GEOJSON.name} ({OUT_GEOJSON.stat().st_size / 1e6:.2f} MB), {OUT_JSON.name}")
    print(f"{len(tiny)} tiny (<{TINY_AREA_KM2:,} km2) get markers: {' '.join(tiny)}")


if __name__ == "__main__":
    main()
