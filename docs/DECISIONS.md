# Decisions

This file records every decision that wasn't fully specified, and why it was made. Newest entries are
added at the end of each section. Dates are when the decision was made.

## Skills (Phase 1, 2026-11-11)

Skills available in this environment: `skill-creator`, `docs`, `docx`, `pdf`, `pptx`, `xlsx`,
`google-workspace`, `consolidate-memory`, `import-memory`, `explain-usage`, `morning`, `setup-claude`,
`su-claude-help`, `dataviz`, `artifact-design`, `artifact-diagramming`, `artifact-capabilities`,
`update-config`, `keybindings-help`, `code-review`, `simplify`, `security-review`,
`fewer-permission-prompts`, `loop`, `schedule`, `claude-api`, `workflow-authoring`, `run`,
`plugin-authoring`, `init`.

| Requested skill | Status | What I use instead / how |
|---|---|---|
| `frontend-design` | **Not installed** | No fallback was specified. I apply the section 7 brief through an explicit design system (D-12) and load the installed **`dataviz`** skill before writing the map, legend, palettes and tooltips, which covers the data-encoding half of the brief. Every UI phase ends with a screenshot critique. |
| `webapp-testing` | **Not installed** | Fallback as specified: **Playwright driven directly** (a Node script using the `playwright` library that saves PNGs to `docs/screenshots/` and fails on console errors). The built-in browser pane is used for quick interactive checks. |
| `skill-creator` | Installed | Used at the start of Phase 3 to write two short project skills in `.claude/skills/`: the LLM contract and the quota/BYOK rules. The build is long and my context will be summarized several times, so these keep the rules consistent. |

Also used: **`claude-api`** for the Anthropic API research below. **`security-review`** and
**`code-review`** may run before the final acceptance pass.

## Verified external facts (Phase 1, 2026-11-11)

Checked against the live docs, not memory.

| Topic | Fact | Source |
|---|---|---|
| Models and prices | `claude-haiku-5-5`: $0.10 in / $0.50 out per MTok for prompts ≤100K tokens ($0.50/$2.50 above), 5-min cache write $0.125, 1-h write $0.20, cache read $0.01. `claude-sonnet-5-5` $2/$10 (read $0.10). `claude-opus-5-5` $4/$20 (read $0.20). `claude-haiku-4-5` $1/$5. | platform.claude.com/docs/en/about-claude/pricing |
| Tool-use overhead | The tool-use system prompt adds 286 tokens (`auto`/`none`) or 406 tokens (`any`/`tool`) on Haiku 5.5. | same |
| Forced tool use | `tool_choice` `{"type":"tool"}` / `{"type":"any"}` returns **400** on Sonnet 5.5, Opus 5.5 and Fable 5.x. Haiku 5.5 accepts it and skips thinking when forced. | claude-api skill, tool-use docs |
| Structured outputs | `output_config: {format: {type: "json_schema", schema}}` works on every current model, including Haiku 5.5. Supported: basic types, `enum`, `const`, `anyOf`, `$ref`, `additionalProperties: false` (required). **Not supported:** numeric/string constraints, array constraints beyond `minItems` 0/1 (so no `prefixItems` tuples). Required properties are emitted first, in schema order. Limits: 24 optional params, 16 union-typed params. Grammars are cached for 24 h. **Incompatible with citations (400).** | platform.claude.com/docs/en/build-with-claude/structured-outputs |
| Strict tool use | `strict: true` on a tool definition guarantees schema-valid `tool_use.input`. | same |
| Web search | `web_search_20250305` (basic) is supported on Haiku 5.5; `_20260209`/`_20260318` add dynamic filtering. $10 per 1,000 searches, plus result tokens billed as input. `max_uses` caps searches per turn. **Citations are always on**, so web search can't be combined with `output_config.format`. Errors come back as HTTP 200 with an error object. Handle `pause_turn` by resending the paused turn. | platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool |
| Prompt caching | Minimum cacheable prefix: **512 tokens** on Haiku 5.5, Sonnet 5.5 and Opus 5.5 (4,096 on Haiku 4.5). Prefix order is `tools` → `system` → `messages`. Up to 4 breakpoints, 5-min default TTL. Usage fields: `cache_creation_input_tokens`, `cache_read_input_tokens`, `input_tokens` (uncached remainder only). A cache entry is readable only once the first response has started. | platform.claude.com/docs/en/build-with-claude/prompt-caching |
| Thinking | Haiku 5.5 runs adaptive thinking by default; `thinking: {type: "disabled"}` is accepted at effort ≤ `high`. Sonnet 5.5 rejects `disabled` and uses `{type: "between_tools"}`. Opus 5.5 can't disable thinking (use low effort). | claude-api skill (model migration guide) |
| Sampling params | `temperature`/`top_p`/`top_k` return 400 under API version `2026-10-21` (and on Haiku 5.5 regardless). | API migration guide 2026-10-21 |
| Python SDK | `anthropic` **2.8.0** sends `anthropic-version: 2026-10-21`, is built on `httpx2`, sends the key as `Authorization: Bearer …`, and a client holds exactly one credential. | PyPI, docs migration-2026-10-21 |
| Google OIDC | Hard-code `https://accounts.google.com/.well-known/openid-configuration`. Use the authorization-code flow with `state` (anti-forgery, stored server-side) and `nonce`. S256 PKCE is advertised. Validate `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, `aud` = client id, `exp`. **Use `sub` as the user key, never email.** A well-tested library is recommended. | developers.google.com/identity/openid-connect/openid-connect |
| Google button branding | Text "Continue with Google" (or Sign in / Sign up). Dark theme: fill `#131314`, 1px inside stroke `#8E918F`, text `#E3E3E3`. Light: `#FFFFFF` / `#747775` / `#1F1F1F`. Standard unmodified full-colour "G". Google Sans Medium 14/20. Padding 12px left of logo, 10px between logo and text, 12px right of text. Rectangular or pill. Must be at least as prominent as other sign-in options. | developers.google.com/identity/branding-guidelines |
| Authlib | 1.9.5 (Python 3.10-3.14). The Starlette client uses `httpx2`'s `AsyncOAuth2Client`. `authorize_access_token(request)` parses and validates the ID token (including nonce) into `token["userinfo"]`. | PyPI, docs.authlib.org |
| Latest packages | FastAPI 0.162.5, uvicorn 0.54, SQLAlchemy 2.1.8, Pydantic 2.14.3, pydantic-settings 2.16.2, itsdangerous 2.2, pytest 9.2. React 19.3, Vite 8.3, @vitejs/plugin-react 6.3, TypeScript 7.0, Tailwind 4.3, MapLibre GL JS 6.18, Vitest 5.1, Playwright 1.65. | PyPI / npm, 2026-11-11 |

## Decisions

### D-1 Project name and location (Phase 1)
**Terrachrome** (terra = earth, chrome = colour), in its own folder and git repo next to the existing
`440/` project, so the two never share files or history.

### D-2 Python version (Phase 1)
The spec asks for Python 3.12. This machine has Python **3.14.7** and no 3.12. The code targets
`>=3.12` and avoids 3.13+ features. `pyproject.toml` declares `requires-python = ">=3.12"`.
Tests ran on 3.14 here. Installing a second interpreter was out of scope.

### D-3 Default model (Phase 1, provisional until the benchmark runs with a key)
`MODEL_ID=claude-haiku-5-5`, the cheapest current model. A per-model **profile** table
(`backend/app/llm/profiles.py`) holds each model's prices, how to turn thinking off, and whether forced
tool use is allowed, so `MODEL_ID` can be switched without code changes. Costs are computed from that
table and the response `usage`.

### D-4 How structured output is obtained (Phase 1)
* **Strategy A (the default path): JSON outputs**, i.e. `output_config.format` with a JSON schema.
  It works identically on every current model, which keeps the benchmark's model comparison fair; forced
  tool use 400s on Sonnet/Opus 5.5. It is guaranteed to match the schema, streams as plain text (so the UI
  can count countries live), and has no tool-prompt overhead.
* **Strategy B (web search): a strict `emit_map` tool plus `web_search`, with `tool_choice: auto`.**
  JSON outputs can't be used with web search, because web search always produces citations and citations
  are incompatible with `output_config.format`. `strict: true` keeps the tool input schema-valid.
* Both paths share one JSON schema and one Pydantic contract, so everything downstream is identical.

### D-5 Row encoding (Phase 1)
Rows stay compact positional arrays as specified: `["FRA", 1397800, "m", "note"]`. Structured outputs
can't express tuple positions (`prefixItems` is unsupported), so the schema says
"array of arrays of string | number | null" and Pydantic enforces the positions, types and the
`h`/`m`/`l` vocabulary. `meta` comes before `rows` and every property is required, so `meta` is always
emitted first and a stream cut off at `max_tokens` can be salvaged up to the last complete row.

### D-6 Prompt caching without padding (Phase 1)
One explicit `cache_control` breakpoint sits on the static system block (rules, entity table, examples,
canonical country list). The user query comes after it, in the user turn. The static prompt is about
5K tokens, well above Haiku 5.5's 512-token minimum, so **no padding was added**. The spec allowed
padding only if needed; it would only be needed on Haiku 4.5 (4,096). A test asserts that the static
prompt is byte-identical across requests, since any change breaks the cache.

### D-7 Thinking off for map generation (Phase 1)
Per-country recall is retrieval, not multi-step reasoning, and thinking tokens bill as output, which is
the expensive side. Strategy A sends Haiku 5.5 `thinking: {type: "disabled"}`. The benchmark includes
an "A + adaptive thinking (low effort)" variant to check whether thinking buys accuracy. Strategy B
keeps adaptive thinking at low effort, because the docs note that Haiku 5.5 with thinking off can skip
a needed tool call when JSON output is also requested.

### D-8 Retrieval tiers (Phase 1, provisional; see RETRIEVAL_BENCHMARK.md)
Tier 0 is the SQL cache (free, uncounted). Tier 1 is strategy A for everyone. Tier 2 is strategy B for
BYOK users only, or with the `ADMIN_WEB_SEARCH` flag. Instead of a second call after a recency flag, the
BYOK request includes the web search tool and the model searches only when the data is recent. That is
still **one call**, and "the model flags it" by deciding to search. Strategy C (World Bank connector) is a
stretch goal behind the `DataSource` interface and the `DATASOURCES_ENABLED` flag.

### D-9 Additions to the LLM contract (Phase 1)
`meta` gains `allows_negative` (so signed metrics like net migration or GDP growth aren't dropped as
invalid negatives), `reason` (the unmappable explanation), and `suggestions` (up to 3 rephrasings shown
in the unmappable state). Strategy B responses also carry the `sources` collected from search results;
they appear in the map's info popover, as the web search terms require.

### D-10 Categorical questions in v1 (Phase 1)
`value_type: categorical` stays in the schema enum, but v1 renders numeric choropleths only. The prompt
asks the model to prefer a natural numeric framing. If none exists, it returns `unmappable` with
suggestions. Categorical maps are a v2 item.

### D-11 Country dataset (Phase 1)
Natural Earth 1:50m, keyed `ISO_A3_EH`, then `ADM0_A3`. Kosovo is `XKX`. Somaliland, Northern Cyprus and
Siachen are merged into their administering polity, uninhabited territories are dropped, and every key is
validated. The tiny-country marker threshold is 12,000 km² (about 5 px at world zoom). Full rules:
`data/README.md`. Display names use Natural Earth `NAME_EN` with a few overrides
(e.g. "United States", "China", "DR Congo"). Dependencies are tagged with their sovereign, e.g. `GRL (DNK)`,
which helps the model decide whether a country's figure includes them.

### D-12 Design system (fallback for the missing `frontend-design` skill; refined in Phase 4)
* **Canvas** `#07070A`, with a faint graticule and vignette so the black reads as space rather than an
  empty page.
* **Glass panels**: translucent near-black (`rgba(14,14,20,0.6)`), `backdrop-filter: blur(20px) saturate(140%)`,
  a hairline `rgba(255,255,255,0.08)` border with a brighter top edge, 14px radius, soft long shadow.
* **Type**: Geist Variable for UI and Geist Mono Variable for numbers, codes and key hints, self-hosted
  through Fontsource (no third-party font requests), with `tabular-nums` on every figure. Geist is the
  "Inter or similar" choice: same neo-grotesk family, more technical in feel.
* **Colour**: neutrals for chrome, one ice-cyan accent (`#7FE7F2`) for focus and interaction, so the
  data palettes own the strong colour. N/A countries are a grey that reads clearly against black, with a
  subtle hatch, so they're never confused with the low end of a palette.
* **Motion**: 180 ms fade+scale for modals, 240 ms slides for panels, a west-to-east colour sweep when
  data arrives. All of it is disabled under `prefers-reduced-motion` or the Appearance setting.

### D-13 Strategy C is a live tier, and its maps are free (Phase 2)
The World Bank connector answered 9 of the 20 benchmark questions in 134-266 ms, at $0, with current
data. Its strict matcher made zero false matches on 22 probes (see RETRIEVAL_BENCHMARK.md). So it runs
before the LLM whenever `DATASOURCES_ENABLED=true` (the default). Like cache hits, World Bank maps
**don't count against the free quota**: the quota exists to bound LLM spend and abuse, and these maps
cost nothing. If the World Bank API fails or times out (8 s), the request falls through to the LLM.

### D-14 Web search is decided by the model within the one call (Phase 2)
BYOK requests (or all requests with `ADMIN_WEB_SEARCH=true`) get the `web_search` tool with
`max_uses=3`, next to the strict `emit_map` tool. The model searches only when the data is recent, so
the "recency flag" costs no second call. `pause_turn` continuations (at most 2) stay inside the same
turn. The basic `web_search_20250305` version is used. Dynamic filtering needs programmatic tool
calling, which isn't documented for Haiku 5.5. `WEB_SEARCH_TOOL` can switch versions.

### D-15 Refusals are treated as unmappable (Phase 2)
A `stop_reason: "refusal"` (a safety decline) becomes an unmappable result with generic suggestions.
It counts against the free quota like any unmappable answer, so refusals can't be used to probe for free.

### D-16 Benchmark ground truth (Phase 2)
World Bank values are fetched once and committed (`bench/ground_truth/wb_*.json`). Historical and ranking
sets are hand-curated `[low, high]` ranges from public reference tables, labelled as such in each file.
Spearman ρ is the headline accuracy metric, because choropleth bins depend on ordering. The benchmark
refuses to run without `ANTHROPIC_API_KEY`, prints the worst case first, and stops before any call that
could exceed `--max-usd`.

### D-17 Mock mode realism (Phase 2)
Mock fixtures cover the example questions. Seven of them are real World Bank data and the rest are
curated midpoints. Mock usage numbers come from the same token estimator the benchmark uses
(`app/llm/estimate.py`), and the mock simulates a 5-minute prompt cache. So quota, budget and cost
displays behave realistically with no key. Questions without a fixture get deterministic synthetic data
labelled "Mock mode".

### D-18 Identity and cookies (Phase 3)
Three cookies, all signed with keys derived from `SESSION_SECRET`, `HttpOnly`, `SameSite=Lax`, and
`Secure` (configurable only for browsers that refuse Secure cookies on `http://localhost`):

| Cookie | Holds | Lifetime |
|---|---|---|
| `tc_vid` | a random anonymous visitor id | 400 days, the longest browsers honour |
| `tc_session` | the user id and the issue time (also checked server-side) | `SESSION_MAX_AGE_DAYS` (30) |
| `tc_oauth` | the transient OAuth `state`, `nonce` and PKCE verifier | 10 minutes |

The database stores only HMACs: `client_hash` of the visitor id, and `ip_hash` of the IP, salted with
`IP_HASH_SALT` or a key derived from the secret. IPv6 addresses are reduced to their /64 prefix before
hashing, so rotating addresses within one allocation doesn't buy fresh quota. Raw IPs are never stored.

### D-19 Quota mechanics (Phase 3)
* Each dimension (visitor, IP, user) is counted separately, and the request is blocked if any one is at
  its limit. That's the spec's "either is over it", extended to the user dimension.
* Signing in claims the visitor's anonymous maps, history **and usage events**. That's how the 24-hour
  window carries over even when the IP changes.
* `reset_at` is the moment a slot frees: the oldest counted event in the window plus 24 h, or, when
  blocked, the latest such moment across all saturated dimensions.
* `FREE_MAPS_PER_IP_PER_DAY` can be raised for shared networks; on a campus NAT the default of 3 is
  shared by everyone behind that IP.

### D-20 What counts against the free quota (Phase 3)
Counted: free-tier LLM calls that end `ok` or `unmappable` (refusals included, see D-15).
Not counted: cache hits, World Bank maps (D-13), rebinning, errors, and BYOK calls.
Not counted either: "no usable data" results (every row invalid), because that is the model's failure.
Their real spend still goes toward the daily budget. If a client disconnects mid-generation, the LLM call
is cancelled and nothing is recorded, because its usage is unknown.

### D-21 Budget breaker (Phase 3)
It sums `cost_est` of non-BYOK usage events since 00:00 UTC. `DAILY_BUDGET_USD=0` turns off free-tier LLM
maps entirely, while cache, World Bank and BYOK keep working. The 503 carries `reset_at` (next UTC
midnight), so the UI can say when free maps resume.

### D-22 Account deletion and quota (Phase 3)
`DELETE /api/me` deletes the user, their maps (and so every history entry pointing at them), their history,
and their usage events, as specified. Deleting usage rows frees that account's own 24-hour window. That is
an accepted trade-off for honouring deletion: abusing it needs a fresh Google sign-in each time, yields
3 maps, and is still bounded by the IP-hash dimension of other visitors' events and the budget breaker.

### D-23 History is separate from usage (Phase 3)
`history_entries` record what was asked, as typed, with a link to the map that answered it. They drive
the history drawer. "Clear history" deletes only these rows, so it can never reset the quota, which is
counted from `usage_events`. Two endpoints were added for this: `GET /api/history` and `DELETE /api/history`.
`GET /api/config` (mode flags for the UI) and `GET /api/health` were also added.

### D-24 CSRF defense in depth (Phase 3)
Mutating API calls must send `X-Requested-With` (any value). Cross-site forms can't add custom headers,
and the API sends no CORS headers, so `SameSite=Lax` plus this header closes cross-site request forgery.

### D-25 Errors: HTTP vs stream events (Phase 3)
Checks that run before streaming (validation, sign-in for BYOK, in-flight, quota, budget) return plain
HTTP errors: 400/403/409/429/503 with `{code, message, …}`. Failures after the stream opens arrive as a
final `error` event with the same shape. One special case: when a World Bank match fails over to the LLM
and the free quota is exhausted, `quota_exceeded` arrives as a stream event. The frontend handles both
paths the same way.

### D-26 Cache rules (Phase 3)
The cache key is a SHA-256 of the normalized question plus the contract version. Normalization covers
NFKC and case, punctuation, filler phrases ("show me", "by country"), articles, and synonyms such as
WWI/World War 1. TTL is 30 days, or 24 h when `recency_sensitive`. Unmappable answers are cached, so
repeated probes cost nothing. Errors and no-data results are never cached. `find_cached()` is the single
lookup, with `semantic_lookup()` as the stubbed v2 hook.

### D-27 Single-process limits (Phase 3)
Per-minute rate limits (60/min overall, 8/min for map creation and key checks) and the one-request-in-flight
lock live in process memory. Running several workers would need a shared store such as Redis (a v2 item).

### D-28 Developer workflow (Phase 3)
All task logic lives in `scripts/dev.py` (Python, cross-platform). The `Makefile` is a thin wrapper, so
`make dev` and `python scripts/dev.py` are equivalent. The first run creates `.env` from `.env.example`
with a random `SESSION_SECRET`, creates `backend/.venv`, and installs dependencies. Re-installs happen only
when the requirement files change (fingerprint stamps). Tests never read the developer's `.env`.
`AUTH_MODE=google` refuses to start with a placeholder or short (<32 character) `SESSION_SECRET`.
