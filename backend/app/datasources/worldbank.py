"""Strategy C: World Bank World Development Indicators for a small catalog of common questions.

Matching is deliberately strict. After removing filler words ("map of", "by country", "latest"), every
remaining word must belong to one indicator's vocabulary, and the question must contain one of that
indicator's core phrases. So "population by country" matches, but "population density", "population
growth" and "population in 1900" don't, and fall through to the LLM. A false match would show the wrong
dataset with full confidence, which is worse than paying for an LLM call.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import re
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass
from typing import Any

import httpx2

from ..countries import CountryIndex, load_countries
from .base import DataSourceError, SourceMatch, SourceResult

API = "https://api.worldbank.org/v2/country/all/indicator/{code}"
FIRST_YEAR = 1960

FILLER = frozenset(
    """what whats is are was were the a an of in on by for each every all country countries nation nations
    world worldwide global globally map maps show me display plot chart list rank ranking ranked rankings
    which how much many latest current currently recent most today now data statistics stats value values
    level levels across around and with their its there do does have has give tell compare comparison top
    please can you i want see view get according as""".split()
)

SYNONYMS = {
    "percentage": "percent", "pct": "percent", "%": "percent", "proportion": "percent",
    "co₂": "co2", "kilometres": "kilometers", "kilometre": "kilometers", "kilometer": "kilometers",
    "km²": "km", "km2": "km", "sq": "square", "per-capita": "per capita",
    "labour": "labor", "defence": "defense", "urbanisation": "urbanization", "expenditures": "expenditure",
    "economies": "economy", "forests": "forest", "users": "user", "births": "birth", "deaths": "death",
    "emission": "emissions", "dollar": "dollars", "women": "woman", "prices": "price",
}


@dataclass(frozen=True)
class Indicator:
    code: str
    title: str
    metric_label: str
    unit: str
    value_type: str
    higher_is: str
    scale: str
    palette: str
    core: tuple[frozenset[str], ...]
    vocab: frozenset[str]
    decimals: int = 1
    allows_negative: bool = False


def _ind(code, title, metric_label, unit, value_type, higher_is, scale, palette, core, vocab, **kw) -> Indicator:
    cores = tuple(frozenset(c.split()) for c in core)
    words = frozenset(vocab.split()) | frozenset(w for c in cores for w in c)
    return Indicator(code, title, metric_label, unit, value_type, higher_is, scale, palette, cores, words, **kw)


CATALOG: tuple[Indicator, ...] = (
    _ind("SP.POP.TOTL", "Population by Country", "Total population", "people", "count", "neutral", "log",
         "viridis", ["population", "inhabitants", "people"],
         "total inhabitants people live living residents per size number", decimals=0),
    _ind("EN.POP.DNST", "Population Density", "People per square kilometer of land area",
         "people per km²", "rate", "neutral", "log", "viridis", ["population density", "density"],
         "population people per kilometers square km land area"),
    _ind("AG.LND.PRCP.MM", "Average Annual Rainfall", "Average precipitation in depth", "mm per year",
         "rate", "neutral", "quantile", "ice", ["rainfall", "precipitation", "rain"],
         "average annual yearly mean total mm millimeters millimetres per year amount depth", decimals=0),
    _ind("AG.LND.TOTL.K2", "Land Area by Country", "Land area", "km²", "count", "neutral", "log",
         "viridis", ["area", "land area", "size"],
         "land total surface square kilometers km territory territorial", decimals=0),
    _ind("NY.GDP.MKTP.CD", "GDP by Country", "Gross domestic product (current US$)", "current US$",
         "currency", "neutral", "log", "viridis", ["gdp", "gross domestic product"],
         "total nominal current us usd dollars economy output", decimals=0),
    _ind("NY.GDP.PCAP.CD", "GDP per Capita", "GDP per person (current US$)", "current US$ per person",
         "currency", "better", "log", "viridis", ["gdp per capita", "gdp per person", "gdp capita"],
         "nominal current us usd dollars average gross domestic product", decimals=0),
    _ind("NY.GDP.PCAP.PP.CD", "GDP per Capita (PPP)", "GDP per person, purchasing power parity",
         "current international $ per person", "currency", "better", "log", "viridis",
         ["gdp per capita ppp", "gdp capita ppp", "gdp per capita purchasing power"],
         "per person current international dollars average gross domestic product parity", decimals=0),
    _ind("EN.GHG.CO2.PC.CE.AR5", "CO₂ Emissions per Capita", "CO₂ emissions excluding land use, per person",
         "tonnes CO₂ per person", "rate", "worse", "quantile", "inferno",
         ["co2 per capita", "carbon per capita", "co2 per person", "emissions per capita",
          "carbon dioxide per capita", "carbon emissions per capita"],
         "co2 carbon dioxide emissions per capita person tonnes tons annual", decimals=2),
    _ind("SP.DYN.LE00.IN", "Life Expectancy at Birth", "Life expectancy at birth", "years", "rate",
         "better", "linear", "verdant", ["life expectancy", "lifespan"],
         "average at birth total years expected"),
    _ind("IT.NET.USER.ZS", "Internet Users", "Individuals using the internet", "% of population",
         "percent", "better", "linear", "neon", ["internet"],
         "user usage use using penetration percent share population individuals people access online connected"),
    _ind("SL.UEM.TOTL.ZS", "Unemployment Rate", "Unemployment (modeled ILO estimate)", "% of labor force",
         "percent", "worse", "quantile", "verdant", ["unemployment", "unemployed"],
         "rate total percent labor force share"),
    _ind("AG.LND.FRST.ZS", "Forest Cover", "Forest area", "% of land area", "percent", "better", "linear",
         "viridis", ["forest", "forested"], "area cover coverage percent share land total"),
    _ind("SP.DYN.TFRT.IN", "Fertility Rate", "Total fertility rate", "births per woman", "rate", "neutral",
         "linear", "viridis", ["fertility", "birth per woman", "children per woman"],
         "rate total birth per woman children average tfr", decimals=2),
    _ind("SP.DYN.IMRT.IN", "Infant Mortality Rate", "Infant deaths per 1,000 live births",
         "deaths per 1,000 live births", "rate", "worse", "quantile", "verdant",
         ["infant mortality", "infant death"], "rate death per live birth thousand 1000"),
    _ind("SP.URB.TOTL.IN.ZS", "Urban Population Share", "Urban population", "% of population",
         "percent", "neutral", "linear", "viridis", ["urban", "urbanization"],
         "population percent share rate living in cities people total"),
    _ind("EG.ELC.ACCS.ZS", "Access to Electricity", "Population with access to electricity",
         "% of population", "percent", "better", "linear", "inferno",
         ["access electricity", "electricity access", "electrification"],
         "to percent share population people with rate"),
    _ind("MS.MIL.XPND.GD.ZS", "Military Spending (% of GDP)", "Military expenditure", "% of GDP",
         "percent", "neutral", "quantile", "inferno",
         ["military gdp", "defense gdp", "military spending percent", "military expenditure percent"],
         "spending expenditure budget as percent share of gdp", decimals=2),
    _ind("NY.GDP.MKTP.KD.ZG", "GDP Growth", "Real GDP growth (annual)", "% per year", "percent", "better",
         "quantile", "verdant", ["gdp growth", "economic growth"],
         "rate annual real percent yearly", allows_negative=True),
    _ind("FP.CPI.TOTL.ZG", "Inflation Rate", "Consumer price inflation (annual)", "% per year", "percent",
         "worse", "quantile", "inferno", ["inflation"], "rate consumer price cpi annual percent",
         allows_negative=True),
    _ind("EG.FEC.RNEW.ZS", "Renewable Energy Share", "Renewable energy consumption",
         "% of final energy use", "percent", "better", "linear", "viridis",
         ["renewable energy", "renewables"], "consumption share percent of total final use"),
    _ind("SE.ADT.LITR.ZS", "Adult Literacy Rate", "Literacy rate, adults 15+", "% of people 15+",
         "percent", "better", "linear", "verdant", ["literacy"], "rate adult total percent literate people"),
)


def tokenize(query: str) -> tuple[list[str], list[int]]:
    """(words, years). Years are 4-digit numbers; other small numbers ('top 10') are ignored."""
    text = unicodedata.normalize("NFKC", query).lower().replace("%", " percent ")
    text = text.replace("co₂", "co2").replace("km²", "km").replace("per-capita", "per capita")
    raw = re.findall(r"[a-z0-9]+", text)
    words, years = [], []
    for tok in raw:
        if tok.isdigit():
            if len(tok) == 4:
                years.append(int(tok))
            continue
        tok = SYNONYMS.get(tok, tok)
        words.extend(tok.split())
    return words, years


class WorldBankSource:
    name = "worldbank"

    def __init__(self, countries: CountryIndex | None = None, *, timeout: float = 8.0):
        self.countries = countries or load_countries()
        self.timeout = timeout

    def match(self, query: str) -> SourceMatch | None:
        words, years = tokenize(query)
        content = {w for w in words if w not in FILLER}
        if not content:
            return None
        year = None
        if years:
            if len(set(years)) > 1:
                return None
            year = years[0]
            if not FIRST_YEAR <= year <= dt.date.today().year:
                return None
        best: Indicator | None = None
        best_core = 0
        for ind in CATALOG:
            if not content <= ind.vocab:
                continue
            hit = max((len(c) for c in ind.core if c <= content), default=0)
            if hit > best_core:
                best, best_core = ind, hit
        if best is None:
            return None
        return SourceMatch(source=self.name, indicator=best.code, title=best.title, year=year)

    async def fetch(self, match: SourceMatch) -> SourceResult:
        ind = next((i for i in CATALOG if i.code == match.indicator), None)
        if ind is None:
            raise DataSourceError(f"unknown indicator {match.indicator}")
        params = {"format": "json", "per_page": "500"}
        if match.year:
            params["date"] = str(match.year)
        else:
            params["mrnev"] = "1"
        started = time.perf_counter()
        body = await self._get_json(API.format(code=ind.code), params)
        latency = int((time.perf_counter() - started) * 1000)
        if not isinstance(body, list) or len(body) < 2 or not isinstance(body[1], list):
            raise DataSourceError("World Bank returned no data")
        payload = self.to_payload(ind, body[1], match.year)
        if len(payload["rows"]) < 10:
            raise DataSourceError("World Bank returned too few countries")
        return SourceResult(
            payload=payload,
            source={
                "name": "World Bank, World Development Indicators",
                "indicator": ind.code,
                "url": f"https://data.worldbank.org/indicator/{ind.code}",
            },
            latency_ms=latency,
        )

    async def _get_json(self, url: str, params: dict[str, str]) -> Any:
        """GET with one retry: the World Bank API intermittently answers 429/5xx."""
        last: Exception | None = None
        async with httpx2.AsyncClient(timeout=self.timeout) as http:
            for attempt in range(2):
                try:
                    resp = await http.get(url, params=params)
                    if resp.status_code == 429 or resp.status_code >= 500:
                        raise httpx2.HTTPStatusError("retryable", request=resp.request, response=resp)
                    resp.raise_for_status()
                    return resp.json()
                except (httpx2.TransportError, httpx2.HTTPStatusError) as exc:
                    last = exc
                    status = getattr(getattr(exc, "response", None), "status_code", 0)
                    if isinstance(exc, httpx2.HTTPStatusError) and status not in (429,) and status < 500:
                        break
                    if attempt == 0:
                        await asyncio.sleep(0.6)
                except ValueError as exc:
                    last = exc
                    break
        raise DataSourceError(f"World Bank request failed: {type(last).__name__}")

    def to_payload(self, ind: Indicator, records: list[dict[str, Any]], year: int | None) -> dict[str, Any]:
        values: dict[str, tuple[float, int]] = {}
        for rec in records:
            code = self.countries.normalize_code(rec.get("countryiso3code") or "")
            value = rec.get("value")
            if code is None or value is None or code in values:
                continue
            try:
                values[code] = (float(value), int(rec.get("date")))
            except (TypeError, ValueError):
                continue
        years = Counter(y for _, y in values.values())
        modal = years.most_common(1)[0][0] if years else year
        rows = []
        for code in sorted(values):
            value, yr = values[code]
            value = round(value, ind.decimals) if ind.decimals else round(value)
            row: list[Any] = [code, value, "h"]
            if yr != modal:
                row.append(f"{yr} value (latest available)")
            rows.append(row)
        if year:
            time_scope, caveats = str(year), []
        else:
            time_scope = f"{modal} (latest available)"
            caveats = [f"Latest available year for each country; most values are from {modal}"] if len(years) > 1 else []
        caveats.insert(0, f"Source: World Bank, World Development Indicators ({ind.code})")
        return {
            "meta": {
                "status": "ok",
                "reason": "",
                "title": f"{ind.title}, {year}" if year else ind.title,
                "metric_label": ind.metric_label,
                "unit": ind.unit,
                "time_scope": time_scope,
                "value_type": ind.value_type,
                "higher_is": ind.higher_is,
                "allows_negative": ind.allows_negative,
                "suggested_scale": ind.scale,
                "suggested_palette": ind.palette,
                "recency_sensitive": True,
                "caveats": caveats[:3],
                "suggestions": [],
            },
            "rows": rows,
        }
