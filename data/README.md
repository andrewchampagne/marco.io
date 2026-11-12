# Country data

| File | Used by | What it is |
|---|---|---|
| `countries.geojson` | frontend map | 232 country polygons, one feature per country, keyed by `properties.iso3` |
| `countries.json` | backend prompt + validation, frontend search/markers | the canonical country list: ISO codes, display name, search aliases, continent, dependency sovereign, area, tiny-country marker point, fly-to box |
| `build_countries.py` | maintainers | regenerates both files from Natural Earth |
| `regions.json` | backend (regional questions) + frontend (region picker, camera, dimming) | the focus regions: whole world, six continents and four hemispheres, each with its member countries and a camera box |
| `build_regions.py` | maintainers | regenerates `regions.json` from `countries.json`; its docstring explains the membership rules (transcontinental countries, straddling the equator or meridian) |

Both files come from the same features, so the country list in the LLM prompt and the polygons on
the map always match 1:1. You never need to run the build script after cloning: its output is committed.

## Source and licence

[Natural Earth](https://www.naturalearthdata.com/) 1:50m Admin 0 Countries
(`ne_50m_admin_0_countries.geojson` from the `nvkelso/natural-earth-vector` repository).
Natural Earth is in the public domain.

## How features are keyed

* The key is `ISO_A3_EH` when it is a valid ISO 3166-1 alpha-3 code, otherwise `ADM0_A3`.
  Plain `ISO_A3` is `-99` for France and Norway (because of overseas territories), so it is never used.
* Kosovo has no ISO code. It is keyed `XKX`, the user-assigned code the EU, IMF and World Bank use.
* Features without any ISO code are merged into the polity that administers them, which matches how
  country-level datasets report them: Somaliland → Somalia, Northern Cyprus → Cyprus,
  Siachen Glacier → India (de facto administration).
* Australia's Indian Ocean Territories and Ashmore and Cartier Islands share Australia's code and are merged into it.
* Uninhabited or research-only territories are dropped: Antarctica, French Southern and Antarctic Lands,
  Heard and McDonald Islands, South Georgia and the South Sandwich Islands, British Indian Ocean Territory.
* The build fails if any output feature lacks a valid, unique three-letter key.

## Processing

* Coordinates are rounded to 3 decimal places (about 110 m), which is far finer than the 1:50m source,
  and consecutive duplicate points are removed. Degenerate rings are dropped.
* Countries under 12,000 km² are flagged `tiny` and get a `marker` point (the centroid of their
  largest polygon). The map draws a small hoverable dot there, because those polygons are only a few
  pixels wide at world zoom.
* `bbox` is a camera box for "fly to country". It covers the main landmass and nearby large islands and
  skips far-flung territories, such as French Guiana for France.

## Rebuild

```bash
python -I data/build_countries.py            # uses data/.cache/ if present, otherwise downloads (3 MB)
python -I data/build_countries.py --refresh  # force a fresh download
```
