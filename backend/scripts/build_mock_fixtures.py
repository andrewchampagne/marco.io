"""Regenerate the LLM_MODE=mock fixtures in app/llm/fixtures/.

World Bank fixtures reuse the benchmark ground truth (bench/ground_truth/wb_*.json, real data).
Historical fixtures use the midpoints of the curated benchmark ranges. Coffee is illustrative.

    cd backend && .venv/Scripts/python -m scripts.build_mock_fixtures
"""

from __future__ import annotations

import json
from pathlib import Path

from app.datasources.worldbank import CATALOG

BACKEND = Path(__file__).resolve().parents[1]
GT = BACKEND / "bench" / "ground_truth"
OUT = BACKEND / "app" / "llm" / "fixtures"

MOCK_CAVEAT = "Mock mode: fixture data for development"


def meta(**kw) -> dict:
    base = {
        "status": "ok", "reason": "", "title": "", "metric_label": "", "unit": "", "time_scope": "",
        "value_type": "count", "higher_is": "neutral", "allows_negative": False, "suggested_scale": "quantile",
        "suggested_palette": "verdant", "recency_sensitive": False, "caveats": [], "suggestions": [],
    }
    base.update(kw)
    return base


def sig3(x: float) -> float:
    if x == 0:
        return 0
    from math import floor, log10
    digits = 3 - int(floor(log10(abs(x)))) - 1
    value = round(x, digits)
    return int(value) if digits <= 0 else value


def wb_fixture(code: str, patterns: list[str]) -> dict:
    ind = next(i for i in CATALOG if i.code == code)
    gt = json.loads((GT / f"wb_{code}.json").read_text(encoding="utf-8"))
    rows = [[iso, value, "h"] for iso, value in sorted(gt["values"].items())]
    return {
        "match": patterns,
        "payload": {
            "meta": meta(
                title=ind.title, metric_label=ind.metric_label, unit=ind.unit, time_scope=gt["time_scope"],
                value_type=ind.value_type, higher_is=ind.higher_is, allows_negative=ind.allows_negative,
                suggested_scale=ind.scale, suggested_palette=ind.palette, recency_sensitive=True,
                caveats=[f"World Bank, World Development Indicators ({code})", MOCK_CAVEAT],
            ),
            "rows": rows,
        },
    }


def curated_fixture(name: str, patterns: list[str], notes: dict[str, str], conf: dict[str, str],
                    use: str = "mid", **meta_kw) -> dict:
    gt = json.loads((GT / f"{name}.json").read_text(encoding="utf-8"))
    rows = []
    for iso, (lo, hi) in sorted(gt["values"].items()):
        value = {"mid": (lo + hi) / 2, "low": lo, "high": hi}[use]
        row = [iso, sig3(value), conf.get(iso, "h")]
        if iso in notes:
            row.append(notes[iso])
        rows.append(row)
    return {"match": patterns, "payload": {"meta": meta(**meta_kw), "rows": rows}}


COFFEE = {  # kg of coffee per person per year, rounded, illustrative
    "FIN": 12.0, "NOR": 9.9, "ISL": 9.0, "DNK": 8.7, "NLD": 8.4, "SWE": 8.2, "CHE": 7.9, "BEL": 6.8,
    "LUX": 6.5, "CAN": 6.5, "AUT": 6.1, "ITA": 5.9, "BRA": 5.8, "SVN": 5.8, "DEU": 5.5, "GRC": 5.4,
    "FRA": 5.4, "HRV": 5.1, "CYP": 4.9, "LBN": 4.8, "EST": 4.5, "PRT": 4.3, "USA": 4.2, "ESP": 4.1,
    "CZE": 3.9, "POL": 3.4, "JPN": 3.4, "AUS": 3.0, "GBR": 2.8, "KOR": 2.4, "RUS": 1.9, "COL": 1.9,
    "CRI": 4.0, "MEX": 1.4, "ETH": 2.0, "TUR": 1.2, "IDN": 1.3, "VNM": 1.9, "ARG": 1.1, "CHN": 0.1,
    "IND": 0.1, "ZAF": 0.8, "SAU": 1.6, "ISR": 3.6, "IRL": 2.7, "HUN": 3.0,
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    fixtures = {
        "population": wb_fixture("SP.POP.TOTL", [
            r"^(?!.*(densit|growth|urban|rural|older|over|under|aged|change)).*\bpopulation\b",
            r"how many people live"]),
        "rainfall": wb_fixture("AG.LND.PRCP.MM", [r"\brain", r"precipitation"]),
        "life_expectancy": wb_fixture("SP.DYN.LE00.IN", [r"life expectancy", r"lifespan"]),
        "gdp_per_capita": wb_fixture("NY.GDP.PCAP.CD", [r"gdp per (capita|person)", r"income per (capita|person)"]),
        "internet": wb_fixture("IT.NET.USER.ZS", [r"\binternet\b"]),
        "co2": wb_fixture("EN.GHG.CO2.PC.CE.AR5", [r"\bco2\b|co₂|carbon (dioxide )?emissions|greenhouse"]),
        "forest": wb_fixture("AG.LND.FRST.ZS", [r"\bforest"]),
        "ww1_deaths": curated_fixture(
            "curated_ww1_deaths",
            [r"world war (1|i|one)\b", r"\bww(1|i)\b", r"first world war", r"great war"],
            notes={"RUS": "Russian Empire", "AUT": "Austria-Hungary", "TUR": "Ottoman Empire, incl. civilian genocide victims",
                   "SRB": "Kingdom of Serbia", "IND": "British India", "GBR": "Includes civilian deaths from air and sea raids"},
            conf={"TUR": "l", "ROU": "m", "GRC": "l", "PRT": "l", "RUS": "m", "SRB": "m", "AUT": "m", "MNE": "l", "JPN": "m", "IND": "m"},
            title="World War I Deaths by Country", metric_label="Total deaths (military and civilian)",
            unit="deaths", time_scope="1914-1918", higher_is="worse", suggested_scale="log",
            caveats=["Defunct states assigned to their principal successor (Russian Empire to Russia, "
                     "Austria-Hungary to Austria, Ottoman Empire to Turkey)",
                     "Civilian death estimates vary widely between sources", MOCK_CAVEAT],
        ),
        "olympic_golds": curated_fixture(
            "curated_olympic_golds", [r"olympic"],
            notes={"RUS": "Includes the Soviet Union and Unified Team", "DEU": "Includes East and West Germany"},
            conf={"RUS": "m", "DEU": "m"},
            title="All-Time Summer Olympic Gold Medals", metric_label="Gold medals, Summer Games 1896-2024",
            unit="gold medals", time_scope="1896-2024", suggested_scale="log", suggested_palette="inferno",
            caveats=["Defunct teams assigned to their principal successor", MOCK_CAVEAT],
        ),
        "unesco_sites": curated_fixture(
            "curated_unesco_sites", [r"unesco|world heritage"], notes={}, conf={}, use="high",
            title="UNESCO World Heritage Sites", metric_label="Inscribed World Heritage Sites", unit="sites",
            time_scope="2025", higher_is="better", suggested_scale="quantile", suggested_palette="viridis",
            recency_sensitive=True, caveats=["Transboundary sites count for every country they span", MOCK_CAVEAT],
        ),
        "nuclear_warheads": curated_fixture(
            "curated_nuclear_warheads", [r"nuclear (warhead|weapon)|warheads"], notes={"ISR": "Undeclared; estimate"},
            conf={"ISR": "l", "PRK": "l", "CHN": "m", "PAK": "m", "IND": "m"},
            title="Nuclear Warheads by Country", metric_label="Total warhead inventory", unit="warheads",
            time_scope="2025", higher_is="worse", suggested_scale="log", suggested_palette="inferno",
            recency_sensitive=True, caveats=["Inventories are estimates from open sources", MOCK_CAVEAT],
        ),
        "world_cup": curated_fixture(
            "curated_world_cup_wins", [r"world cup"], notes={"GBR": "England", "DEU": "Includes West Germany"},
            conf={}, use="low", title="FIFA World Cup Titles", metric_label="Men's World Cup titles",
            unit="titles", time_scope="1930-2022", higher_is="better", suggested_scale="linear",
            suggested_palette="neon", caveats=["Counts through the 2022 tournament", MOCK_CAVEAT],
        ),
    }
    fixtures["coffee"] = {
        "match": [r"\bcoffee\b"],
        "payload": {
            "meta": meta(title="Coffee Consumption per Person", metric_label="Coffee consumed per person per year",
                         unit="kg per person per year", time_scope="around 2020", value_type="rate",
                         suggested_scale="quantile", suggested_palette="inferno",
                         caveats=["Interpreted as consumption per person, not production", MOCK_CAVEAT]),
            "rows": [[iso, value, "m"] for iso, value in sorted(COFFEE.items())],
        },
    }
    for name, body in fixtures.items():
        (OUT / f"{name}.json").write_text(json.dumps(body, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{name:18} {len(body['payload']['rows']):3} rows")


if __name__ == "__main__":
    main()
