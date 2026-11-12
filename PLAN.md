<!-- Approved plan (2026-11-11). Phase status is tracked at the bottom of this file. -->

# Terrachrome: AI choropleth map generator, implementation plan

## Context

You want a web app where someone types a question ("WW1 deaths per country", "average annual rainfall") and gets a sleek, dark, interactive world choropleth. The app makes **one** LLM call for all countries, then the backend validates, fills, and bins the result. The app needs a free tier (3 maps per rolling 24h), Google sign-in, BYOK for unlimited use, strict cost controls, and mock modes so it can be developed with zero external setup.

The working folder `...\Projects\Web` already holds an unrelated project (`440/`). The new project gets its own root and git repo at **`...\Projects\Web\terrachrome\`**. **Name: Terrachrome** (terra = earth, chrome = colour).

## Verified facts (Phase 1 doc check, 2026-11-11)

| Topic | Finding | Consequence |
|---|---|---|
| Cheapest model | `claude-haiku-5-5`: $0.10 in / $0.50 out per MTok (prompts ≤100K), 5m cache write $0.125, cache read $0.01. Sonnet 5.5 is $2/$10, Opus 5.5 is $4/$20. | Default `MODEL_ID=claude-haiku-5-5`, pending the benchmark. Output tokens are about 90% of cost per map, so the compact row format is the main lever. |
| Forced tool use | `tool_choice` `tool`/`any` returns 400 on Sonnet 5.5, Opus 5.5 and Fable. It still works on Haiku 5.5, where it skips thinking. | Model-agnostic code can't rely on forced tool use. |
| Structured outputs | `output_config.format` (json_schema) works on every current model and streams as text. Arrays support only `minItems` 0/1, so no tuple/`prefixItems`. Required props are emitted first, in schema order. Limit: 16 union-typed params. **Incompatible with citations (400).** | **Strategy A uses JSON outputs.** Rows are `array<array<anyOf[string,number,null]>>`; Pydantic enforces the positions. `meta` comes before `rows`, all required, so a truncated stream can be salvaged. |
| Web search | `web_search_20250305` (basic) supports Haiku 5.5. Cost is $10/1K searches, plus result tokens billed as input. Citations are always on. Handle `pause_turn`. | Strategy B cannot use JSON outputs. It uses a **strict `emit_map` tool** + `web_search` (`max_uses` cap), `tool_choice: auto`, and `eager_input_streaming` for live progress. |
| Prompt caching | Haiku/Sonnet/Opus 5.5 minimum is **512 tokens** (Haiku 4.5 was 4096). Prefix order is tools → system → messages. Usage fields: `cache_creation_input_tokens`, `cache_read_input_tokens`, `input_tokens`. | Explicit `cache_control` on the static system block. The prompt is about 5K tokens, so **no padding is needed** (recorded in DECISIONS). |
| Thinking | Haiku 5.5 thinks by default. `thinking:{type:"disabled"}` is allowed at effort ≤ high. Sonnet 5.5 needs `between_tools`. Opus 5.5 can't disable thinking. Sampling params return 400. | A per-model "profile" table (thinking params + prices). Never send `temperature`. |
| Python SDK | `anthropic` 2.8.0 (API version `2026-10-21`, httpx2). It sends the key as `Authorization: Bearer`. One credential per client. | A BYOK request gets its own short-lived `AsyncAnthropic(api_key=...)`. The log redaction regex covers `sk-ant-…` anywhere. |
| Google OIDC | Hard-code the discovery doc. Use `state` + `nonce`; S256 PKCE is supported. Key users on `sub`, never email. A well-tested library is recommended. | Authlib 1.9.5 Starlette client (httpx2), with `code_challenge_method="S256"` and transient state in a 10-min SessionMiddleware cookie. |
| Google branding | Use "Continue with Google". Dark theme: fill #131314, 1px stroke #8E918F, text #E3E3E3. Unmodified full-colour G. Padding 12/10/12px. Google Sans Medium 14/20. Rectangular or pill. | A custom button that follows the guidelines, since the server-side code flow can't use the GIS SDK. |
| Environment | Python **3.14.7** (no 3.12; code targets ≥3.12), Node 24, npm 11, GNU Make 4.4.1, git. No `ANTHROPIC_API_KEY` is set. Latest: FastAPI 0.162, SQLAlchemy 2.1, Pydantic 2.14, React 19.3, Vite 8, TS 7, Tailwind 4.3, MapLibre **6.18**, Vitest 5. | The benchmark harness is built and dry-run, but real A/B measurements need your key (see risks). |

**Skills:** `frontend-design` and `webapp-testing` are **not installed**. The fallbacks are: apply the section 7 design brief directly, write a short design system in DECISIONS, use the installed **`dataviz`** skill for palettes, legend and tooltips, and drive Playwright directly. `skill-creator` is installed. In Phase 3 I'll write two short project skills (LLM contract, quota/BYOK rules) because the long build will be context-summarized. `claude-api` was used for this research.

## Architecture

```
terrachrome/
  Makefile, scripts/dev.py (cross-platform: auto-setup + run both), .env.example, README.md, PLAN.md
  data/   build_countries.py → countries.geojson (NE 50m, keyed ISO_A3_EH→ADM0_A3, props stripped,
          coords quantized, tiny-country centroids) + countries.json (canonical list used in the prompt)
  backend/app/  main.py config.py db.py models.py migrations.py identity.py auth.py quota.py ratelimit.py
                cache.py processing.py binning.py sse.py logging_redact.py routes/*.py
                llm/ contract.py prompt.py profiles.py client.py mock.py fixtures/
                datasources/ base.py (DataSource protocol) worldbank.py
  backend/bench/  queries.json ground_truth/ fetch_ground_truth.py run.py report.py
  backend/tests/  pytest suite
  frontend/src/   api/ map/ components/ settings/ state/ lib/ styles/ (+ *.test.ts), e2e/screenshots.mjs
  docs/   DECISIONS.md RETRIEVAL_BENCHMARK.md screenshots/
```

**Request flow, POST /api/maps:** sanitize the query (≤200 chars, strip control chars) → identify the client (signed visitor cookie + salted IP hash + optional session) → 403 `signin_required` if `X-Anthropic-Key` arrives without a session → per-minute rate limit → one in-flight request per client (409) → **Tier 0** `find_cached(normalized hash)`, which is free and uncounted (it also serves users who are over quota) → quota check (429 `{code:"quota_exceeded", reset_at, signed_in}`) and budget breaker (503, free tier only) → open the SSE stream: `status: Interpreting` → **retrieval** → `status: Gathering data · N countries` (rows counted live from stream deltas) → `status: Building map` → validate, fill N/A, compute stats, bin → persist the map and history, log the usage event → `result` (map + updated usage).

**Retrieval tiers (provisional, the benchmark confirms or overturns them):**
- **C (stretch, behind a flag):** a World Bank connector for a small catalog (population, area, GDP/capita, life expectancy, precipitation, internet %, unemployment, forest %, CO2/capita). Strict phrase matcher. The data is authoritative and costs $0.
- **A (free tier and default):** one Haiku 5.5 call, thinking off, JSON outputs, cached system prompt, no tools.
- **B (BYOK only, or the `ADMIN_WEB_SEARCH` flag):** the same call plus `web_search` (`max_uses=3`) and the strict `emit_map` tool. The model searches only when the data is recent or time-sensitive, so this is still **one call** and "the model flags it" by searching. Sources are surfaced in the info popover.
- A `find_cached()` stub notes where an embedding-based semantic cache plugs in later. No RAG.

## LLM contract (system prompt + schema)

- **Schema** (all required, `meta` first): `meta{title, metric_label, unit, time_scope, value_type(count|rate|percent|index|currency|categorical), higher_is(worse|better|neutral), suggested_scale(linear|log|quantile), suggested_palette, caveats[≤3], recency_sensitive, allows_negative, status(ok|unmappable), reason, suggestions[]}` and `rows: [[iso3, value, conf("h"|"m"|"l"), note|null], …]`. My additions: `allows_negative` (so net migration and growth rates aren't dropped), `reason`, and `suggestions` (rephrasings shown in the unmappable state).
- **Static system prompt (cached):** role, field semantics, rules 1-8 verbatim in substance, a defunct-entity table (USSR→RUS, Austria-Hungary→AUT, Ottoman→TUR, Yugoslavia→SRB, Czechoslovakia→CZE, British India→IND, Persia→IRN, …, original entity named in the note, policy stated once in caveats), confidence calibration, palette/scale guidance, unmappable examples (chit-chat, code, single facts, categorical-only questions in v1), 2 compact worked examples, and the canonical `ISO3 Name` list generated from the same GeoJSON. The query goes in the user turn as `<user_query>…</user_query>`, with tags escaped.
- **Compact output:** rows only for countries with data; notes only when informative.

## Backend processing (deterministic)

- **Validate:** coerce enums to safe defaults, uppercase and alias ISO codes (e.g. XKX/KOS, ROM→ROU), drop unknown codes and duplicates, coerce numerics ("1,397,800" → 1397800), drop NaN/inf, drop negatives unless `allows_negative`, truncate notes to 80 chars. A zero-row "ok" response becomes a non-counted `empty` error. `value_type=categorical` becomes unmappable in v1.
- **Fill** every canonical country (value null), then compute stats (min, max, median, count, na_count).
- **Binning** (backend computes the edges, never trusting the model): quantile (deduped edges), equal-interval, and log (zeros go to the lowest bin; negatives fall back to quantile). Default 7 classes, adjustable 3-9. All-equal values or a single value give one class. The response returns bin **indices** plus legend `{min, max, count}`, the requested and effective method, and the fallback reason.
- **Persist:** map (slug, raw/normalized query, hash, meta, rows, model, strategy, tokens incl. cache read/write, cost_est, user_id?, client_hash, contract_version, status, created_at). Cache TTL is 30 days, or 1 day if `recency_sensitive`.

**Endpoints:** everything in the spec section 5 (`POST /api/maps` SSE, `GET /api/maps/{slug}`, `POST /api/maps/{slug}/rebin`, `GET /api/usage`, `POST /api/key/validate`, `GET /api/examples`, Google login/callback, logout, `GET/DELETE /api/me`, `GET /api/me/export`), **plus** `GET/DELETE /api/history` for the history drawer and "clear history". In production FastAPI also serves the built SPA, with `/m/{slug}` getting OG tags.

## Quotas, cost control, BYOK, auth

- **Tables:** `users`, `maps`, `usage_events` (+ `byok`, `counted`, `map_id`, cache token columns), `history_entries`, `schema_migrations`. Simple versioned migrations run at startup. SQLite by default; `DATABASE_URL` switches to Postgres.
- **Rolling window:** `used = max(count by client_hash, count by ip_hash, count by user_id)` over counted events in the last 24h. Counted means a free-tier LLM call that ended `ok` or `unmappable`; cache hits, errors and BYOK calls don't count. `reset_at` is when a slot frees. On sign-in the visitor's anonymous maps, history and usage events are claimed, so the window carries over and signing in never resets it. The per-IP limit is separately configurable because many users can share one NAT (e.g. a campus); noted in DECISIONS.
- **Abuse controls:** a 200-char cap, `MAX_OUTPUT_TOKENS=4000`, a fixed model, one in-flight request per client, an in-memory per-minute limiter (general + stricter on maps/validate), and no tools on the free tier. The **budget breaker** sums free-tier `cost_est` for the current UTC day against `DAILY_BUDGET_USD`, returns a friendly 503, and BYOK keeps working.
- **BYOK:** the key comes only in the `X-Anthropic-Key` header, is never persisted, and is redacted by a root logging filter (`sk-ant-[\w-]+`) and from error bodies. A test pushes a sentinel key through the success and error paths and asserts it appears in no log record, response or DB row. Validation makes a 1-token call on `MODEL_ID` and maps errors to invalid_key, no_credit or unavailable.
- **Sessions:** itsdangerous-signed cookies, httpOnly, Secure (configurable for Safari localhost), SameSite=Lax, with max-age. `tc_session` holds the user id and issue time, `tc_vid` the anonymous visitor id, `tc_oauth` the transient OAuth state. Mutating endpoints require an `X-Requested-With` header as CSRF defense-in-depth. `AUTH_MODE=mock` makes login redirect straight to the callback with a fake Google user, so no Google setup is needed.

## Frontend (React 19 + TS + Vite 8 + Tailwind 4 + MapLibre 6)

- **Look:** #07070A canvas, a faint graticule, glass panels (blur, saturate, hairline borders), Geist + Geist Mono variable fonts (self-hosted via fontsource; "Inter or similar") with tabular numerals, one ice-cyan accent, 180ms motion, `prefers-reduced-motion` respected. N/A is a visible grey (tuned in screenshots) plus hatching, so it's never confused with palette lows. No router or icon libraries: a small history-API router, inline SVG icons, and a `useSyncExternalStore` store.
- **Map:** bundled GeoJSON, no tiles, `promoteId: iso3`. Colours come through feature-state, so palette, reverse, bin count and method changes are instant and make no LLM call. A west-to-east reveal sweep runs when data arrives (one paint-expression update per frame). Hover brightens the country with an outline glow and a tooltip (value + unit, confidence badge, note). Click opens a slide-in detail panel (rank, percentile, bin, note, caveats). Tiny countries get centroid dot markers that fade out with zoom. Hovering a legend bin dims everything else. Country search flies to and highlights a country. Optional globe toggle.
- **Palettes:** Verdant→Maroon (default), Viridis, Inferno, Ice, Neon, Mono, Cividis (colourblind-safe). Each is a ramp interpolated in OKLab, with dark-canvas-safe low ends. Reverse defaults from `higher_is`. Appearance settings offer "Auto (AI-suggested)" or a fixed choice.
- **Layout:** as specified. Logo and history drawer top-left; command bar top-centre (rotating placeholders, starter chips, usage line under it); a single avatar/gear button top-right that opens Settings (880×600 glass modal: Account, API Key, Usage, Appearance, Privacy, About; focus trap, Esc/backdrop to close, full-screen list→detail below 768px). Access modal in two steps with a live countdown, a "last free map" toast, and the blocked query resumed after a key is saved (it survives the OAuth redirect via sessionStorage). Legend bottom-left; controls, country search and export (PNG with title and legend composited, CSV, share link `/m/{slug}`) bottom-right. Friendly states for unmappable, rate-limited, budget, network and invalid key.

## Phases (commit after each, after its tests pass)

1. **Plan and data:** `git init`, PLAN.md, docs/DECISIONS.md (skills, verified API facts, decisions), and `data/build_countries.py` to download Natural Earth 50m (3.1 MB, public domain), key it, strip and quantize it, compute tiny-country markers, and **assert every feature has a valid unique key**. Also .gitignore and a README stub.
2. **Retrieval spike:** the LLM layer (contract, prompt builder, model profiles/pricing, streaming client with truncation salvage, mock client and fixtures), the World Bank `DataSource`, and the bench harness: 20 queries across historical totals, current stats, rankings, rates/percentages, ambiguous and non-mappable/injection. Ground truth is World Bank data fetched once plus curated WW1/WW2/Olympics/UNESCO/warhead figures with ranges. It compares A, A+thinking, B, C (and A on Sonnet 5.5) on validity, status accuracy, coverage, Spearman ρ, MdAPE, tokens (in, cache read/write, out), $ and latency. It refuses to run without a key and has a `--max-usd` cap (default $1) plus `--dry-run`. RETRIEVAL_BENCHMARK.md will show measured C numbers, projected A/B costs and a provisional decision, and it regenerates when you run `make bench`.
3. **Backend:** the app, DB/migrations, processing and binning, cache, quotas, rate limits, budget, identity/sessions, Authlib + mock auth, all endpoints and SSE, BYOK, and redaction. **pytest** covers every section 8 item, plus budget 503, in-flight 409, unmappable counting, export and SSE format.
4. **Frontend:** everything above except the polish. **Vitest** covers palette interpolation, formatting, the SSE parser and key storage. A Playwright screenshot script and the **visual verification routine**, then fix and re-shoot.
5. **Polish:** reveal/shimmer animations, tiny-country markers, PNG/CSV export, share links + OG tags, all error states, keyboard and a11y pass, 820px and 390px layouts. Visual verification again; screenshots go to docs/screenshots/.
6. **Ship:** README (clone to running in 3 steps: `git clone`, `make dev` which auto-installs, open the URL; Google OAuth client + redirect URI setup; BYOK; bench), the final .env.example, a scripted acceptance run against the section 8 criteria, and known limitations + v2 ideas.

## Verification

- `make test`: pytest (mock LLM, mock auth, temp SQLite, `https://testserver` so Secure cookies flow) + vitest.
- Live flow with `LLM_MODE=mock AUTH_MODE=mock make dev`: query to map; 4th query opens the Access modal → mock Google sign-in → key step → save → the blocked query resumes; reload keeps a remembered key; a signed-in user without a key still hits 3/day; a repeat query shows 0 tokens; palette and binning changes make no network LLM call (asserted in the Playwright script via request log).
- The Playwright screenshot routine covers every listed state at desktop, 820px and 390px, and fails on console errors.
- Real-key checks (WW1 map, benchmark) run only when you provide `ANTHROPIC_API_KEY`.

## Risks and things I can't do alone

- **No API key in this environment:** A/B accuracy and token numbers stay *projected* until you run `make bench` (capped at about $1; at Haiku prices a full run is roughly $0.10-0.30). Everything else is fully testable in mock mode.
- Google OAuth is verified only in mock mode here. The real flow needs your OAuth client; the README documents the steps.
- Rate limits and the in-flight lock live in memory, so they're single-process (noted, Redis is a v2 item). OneDrive syncing `node_modules` and `.venv` is slow but harmless; noted in the README.

## Phase status

- [x] Phase 1: plan, decisions, country data
- [ ] Phase 2: retrieval benchmark spike and decision
- [ ] Phase 3: backend with tests and mock modes
- [ ] Phase 4: frontend + visual verification
- [ ] Phase 5: polish + visual verification
- [ ] Phase 6: README, .env.example, acceptance run, limitations
