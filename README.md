# marco.io

Ask a question about the world, and get an interactive map.

> *"How many deaths were there in each country in World War 1?"* · *"Average annual rainfall by country"* ·
> *"Nuclear warheads by country"*

One AI call returns a value for every country it can defend. The backend validates the result, fills in
"no data", and bins it, and a dark, glassy MapLibre map colours it in. Common statistics (21 World Bank
indicators, such as population, rainfall, GDP per capita and life expectancy) come straight from the
World Bank with no AI call. Repeat questions come from a cache.

![World War I deaths by country](docs/screenshots/06-map-ww1.jpg)

* **Bring your own OpenAI key.** There are no accounts and no free tier. On a first visit the app asks
  for an OpenAI API key. The key is checked, kept in your browser, and sent only with your own map
  requests. It is never stored on the server. Each map costs a fraction of a cent on your OpenAI account.
* **Complete, and honest about it.** The AI gives the best available value for every country it can:
  official figures when they exist, otherwise unofficial sources or a reasoned estimate. Every value
  carries a confidence level, and notes flag unofficial figures, estimates and historical states (e.g. "Russian Empire").
  Each map says *AI-generated estimates, verify before citing*.
* **Shareable.** Every map has a link (`/m/{slug}`) that anyone can open without a key.
* **Saveable as a file.** Save a map to *My maps* in your browser, or download it as a `.marco` file
  (versioned JSON: data, legend settings and the exact view). Opening one, on any computer, needs no key
  and makes no AI call. Cloud saving can plug in later behind the same `MapStore` interface (D-42).

## Quick start

You need **Python 3.12+**, **Node.js 20+** and **git**.

```bash
git clone <this-repo-url> marco && cd marco
```

```bash
make dev
```

Then open **http://localhost:5173**. No make? Run `python scripts/dev.py` instead; every make target is a
`scripts/dev.py` command.

The first run takes about a minute: it creates `.env` with a random `SESSION_SECRET`, `backend/.venv`, and
`frontend/node_modules`. The default is **`LLM_MODE=mock`**: answers come from fixtures, and the key
prompt accepts any made-up key in the right shape (`sk-proj-` followed by 20 or more letters, digits or
dashes), so nothing is billed. A key containing `invalid` simulates a rejected key.

| Command | What it does |
|---|---|
| `make dev` | Run the API (:8000) and the web app (:5173) with hot reload; installs what's missing first |
| `make test` | Backend tests (pytest, 137) and frontend tests (vitest, 23) |
| `make screenshots` | Visual verification: drives the app in Chrome and writes 36 screenshots to `docs/screenshots/` |
| `make bench` | Retrieval benchmark against the real API (needs `OPENAI_API_KEY` in your shell; capped at $1) |
| `make build` / `make start` | Production build; the API then serves the app on :8000 |
| `make setup` / `make clean` / `make data` | Install / remove dependencies / rebuild the country dataset |

> OneDrive, Dropbox and similar folders work, but syncing `node_modules` and `.venv` is slow. Consider
> cloning outside a synced folder.

## Real AI answers

Set `LLM_MODE=live` in `.env` and restart. That's all: the server holds no key. Each visitor enters
their own OpenAI key in the browser (get one at https://platform.openai.com/api-keys).

The default model is `gpt-6.1-terra` (reasoning effort `low`), chosen over the cheaper `gpt-6-luna` for
accuracy. It costs about 10x as much per token ($1 in / $5 out per million, so roughly a cent per
full map); see [docs/RETRIEVAL_BENCHMARK.md](docs/RETRIEVAL_BENCHMARK.md), whose projections are for
`gpt-6-luna`. Run `make bench` once with `OPENAI_API_KEY` set in your shell to measure. To go cheaper,
set `OPENAI_MODEL_ID=gpt-6-luna`. Per-model prices and reasoning settings live in
`backend/app/llm/profiles.py`, so no code changes are needed.

### How the key is handled

* The key prompt opens on a first visit, and again whenever a question needs the AI and no working key
  is saved. A question asked without a key waits and runs as soon as the key is saved. You can also
  manage the key under **Settings → API key**.
* The key is checked first by looking up the model with it (no tokens used). Then it is kept in the
  browser: in `localStorage` with "Remember on this device", otherwise in `sessionStorage`.
* It is sent only on map requests and key checks, in the `X-OpenAI-Key` header. The server uses it for
  that one request and never stores or logs it. A redaction filter and tests enforce that.
* Cached maps, World Bank maps and shared links need no key. If OpenAI rejects the key, the prompt
  reopens; if the account has no credit, a message says so.

## How it works

```
Browser ──POST /api/maps (SSE, X-OpenAI-Key)──▶ FastAPI
                                   ├─ checks: 200-char limit · key shape · 1 request in flight · rate limits
                                   ├─ Tier 0  SQL cache on the normalized question ............ no key needed
                                   ├─ Tier C  World Bank connector (21 indicators) ............ no key needed
                                   └─ Tier 1  one OpenAI call on the visitor's key: strict JSON, cached
                                              prompt, web search if the model judges the data recent
                                        │      (no key? 401 key_required, and the browser asks for one)
                                        ▼  deterministic: validate ISO codes, coerce numbers, drop invalid,
                                           fill N/A, stats, quantile / equal / log bins (backend edges)
Browser ◀── status · progress (live country count) · result (bin indices + legend) ──┘
```

* **One AI call per map**, covering every country. Rows are compact arrays (`["FRA", 1397800, "m"]`),
  because output tokens are about 90% of the cost.
* The system prompt (rules, successor table for historical states, examples, and the canonical country
  list generated from the same GeoJSON as the map) is an identical prefix on every call, which OpenAI
  caches automatically. The user's question arrives inside `<user_query>` tags and is treated as
  untrusted data.
* The server returns bin **indices**, not colours, so palette changes are instant. Re-binning
  (3-9 classes; quantile, equal or log) runs on stored values: no AI call.
* There are no accounts. A signed, random visitor cookie owns the history drawer, and a salted hash of
  the IP keys the per-minute rate limits. Raw IPs are never stored.

More: [PLAN.md](PLAN.md) · [docs/DECISIONS.md](docs/DECISIONS.md) (40 recorded decisions) ·
[docs/RETRIEVAL_BENCHMARK.md](docs/RETRIEVAL_BENCHMARK.md) · [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) ·
[data/README.md](data/README.md)

### API

| Endpoint | Purpose |
|---|---|
| `POST /api/maps` | `{query}` plus `X-OpenAI-Key` → server-sent events `status`, `progress`, then `result` or `error` |
| `GET /api/maps/{slug}` | A saved map (share links `/m/{slug}`) |
| `POST /api/maps/{slug}/rebin` | `{method, classes}` → new bins; no AI call |
| `POST /api/key/validate` | Checks the key in `X-OpenAI-Key`; the key is never stored |
| `GET /api/history` · `DELETE /api/history` | History drawer for this browser · clear it |
| `GET /api/export` | Everything stored about this browser, as JSON |
| `GET /api/examples` · `GET /api/config` · `GET /api/health` | Starter questions · mode flags · liveness |

Errors are always `{code, message, …}`: `key_required` (401), `invalid_key`, `no_credit`,
`rate_limited` (429), `in_flight` (409), `query_too_long` (400), and others. Mutating calls must send
`X-Requested-With` (CSRF defense in depth).

## Configuration

Everything is in [`.env.example`](.env.example), with a comment per setting. The most important:

| Variable | Default | Notes |
|---|---|---|
| `LLM_MODE` | `mock` | `live` for real OpenAI calls (on each visitor's key) |
| `OPENAI_MODEL_ID` | `gpt-6.1-terra` | gpt-6-luna, gpt-6.1-terra and gpt-6.1-sol have price profiles; others are costed high |
| `MAX_OUTPUT_TOKENS` | `4000` | hard cap per map |
| `WEB_SEARCH_ENABLED` / `WEB_SEARCH_MAX_USES` | `true` / `3` | the model searches only when data is recent |
| `RATE_LIMIT_PER_MINUTE` / `MAPS_RATE_LIMIT_PER_MINUTE` | `60` / `8` | per IP hash |
| `DATASOURCES_ENABLED` | `true` | World Bank tier |
| `DATABASE_URL` | SQLite in `backend/var/` | e.g. `postgresql+psycopg://…` after `pip install "psycopg[binary]"` |
| `TRUST_PROXY_HEADERS` / `TRUSTED_PROXY_HOPS` | `false` / `1` | only behind a proxy you control |

## Production

```bash
make start
```

This builds the frontend, then runs one uvicorn process on http://localhost:8000 that serves the API and
the app from the same origin. On a server, put it behind a reverse proxy that terminates TLS (Caddy,
nginx): visitors' keys travel in request headers, so the site must use HTTPS. Then set
`TRUST_PROXY_HEADERS=true` and `TRUSTED_PROXY_HOPS` (so per-IP rate limits see the real client address),
a real `SESSION_SECRET`, and `DATABASE_URL` if you want Postgres.

The API adds Open Graph tags to `/m/{slug}` share links, gzips JSON and static files (never the event
stream), and sends a strict Content-Security-Policy. **Run a single worker process:** per-minute limits
and the in-flight lock live in memory.

## Testing

* `make test`: **137 backend tests** cover schema validation (including OpenAI strict-mode rules), ISO
  filtering, N/A fill, binning (quantile, equal, log, all-equal, single value, outliers, tied values),
  cache normalization and zero-token cache hits, rebinning, `key_required` without a key, the visitor's
  key being the one used, the OpenAI client against a scripted Responses stream (request shape, usage
  and cost, truncation, refusals, web search and its fallback, error mapping), the visitor cookie, proxy
  headers, and the key never reaching logs, responses or the database. **60 frontend tests** cover
  palettes, formatting, the SSE parser, key storage, CSV injection, browser binning (checked against the
  backend's outputs), `.marco` file round trips and validation of untrusted files, the local map store, and the map's zoom and edge limits.
* `make screenshots`: a Playwright run against isolated servers, using your installed Chrome or Edge.
  It walks every state (first-visit key prompt, empty, a question waiting for a key, loading, map,
  tooltip, legend hover, details, palettes, rebinning, info, table, share and export, history, all
  Settings tabs, unmappable, reload, a shared link without a key, every error state, tablet and phone).
  It fails on console errors. To check everything without rewriting the committed screenshots, run
  `node e2e/screenshots.mjs --out=<some folder>` from `frontend/`.
* `make bench`: see [docs/RETRIEVAL_BENCHMARK.md](docs/RETRIEVAL_BENCHMARK.md).

## Known limitations

* **Unmeasured AI accuracy and cost.** The benchmark's AI strategies need a key that wasn't available
  while building, so gpt-6-luna's accuracy and per-map cost are projections until `make bench` runs. The
  live OpenAI API was never called from this build: the client is tested against scripted SDK streams.
* **No accounts, for now.** History belongs to the browser (a cookie), so it doesn't follow you across
  devices, and clearing cookies loses it. Your key is kept per browser too.
* **No abuse protection beyond rate limits.** Every AI call is paid by the visitor's own key, so there is
  no shared budget to protect; per-minute limits and the 200-character cap still apply.
* **OpenAI web search with structured output** isn't documented by OpenAI. If the API rejects the
  combination, maps quietly fall back to a call without search (DECISIONS D-39).
* **Key checks use no tokens**, so a key with no credit passes the check and fails on its first map with
  a clear "no credit" message.
* **Knowledge cutoff.** Without web search, recent figures can be stale. Recency-sensitive maps are cached
  for 24 h instead of 30 days.
* **Countries only, numbers only.** No sub-national regions or cities. Categorical questions ("official
  language") are declined with numeric suggestions.
* **Historical states** map to their principal successor (USSR → Russia, Austria-Hungary → Austria), with
  a note. Splitting a historical figure across modern successors isn't attempted.
* **Single process.** Rate limits and the in-flight lock are in memory. SQLite is the tested database;
  Postgres is supported through SQLAlchemy but wasn't exercised here.
* **Map projection.** Web Mercator exaggerates high latitudes (Greenland, Russia). Tiny territories are
  shown as dots. Phones open on a partial world view.

## v2 ideas

* **Accounts and a free tier**, restorable from git history (commit `6d1cb4b` had Google sign-in, a
  3-maps-a-day free tier on a server key, and a daily budget breaker).
* **More AI providers** behind the same generator protocol (a second provider's client existed in
  `6d1cb4b`).
* **Semantic cache.** `find_cached()` already has a `semantic_lookup()` stub; embed normalized questions and
  reuse near-duplicates within a similarity threshold.
* **More dataset connectors.** Our World in Data, UN and IMF behind the existing `DataSource` interface.
* **Categorical and diverging maps.** Category legends, qualitative palettes, and a diverging scheme
  around zero for signed metrics.
* Shared rate limiting (Redis) for multi-worker deployments.
* An equal-area or globe projection, sub-national boundaries, time sliders for year-by-year series, and
  citations per value from web search.
