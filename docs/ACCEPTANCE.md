# Acceptance record

The final acceptance run for Phase 6, on 2026-11-11: Windows 11, Python 3.14.7, Node 24, Chrome. It checks
every acceptance criterion and every test the spec lists in section 8. Everything passes except two items
that need things this environment doesn't have: a real Anthropic API key and a Google OAuth client.

## What was run

| Run | Result |
|---|---|
| `make test` | **150 backend tests passed** (pytest) and **22 frontend tests passed** (vitest) |
| Browser walk: `node e2e/screenshots.mjs --out=<temp dir>` (the routine behind `make screenshots`) | 42 screenshots, every check passed, no console errors. The committed set in `docs/screenshots/` comes from the identical Phase 5 run; the code hasn't changed since. |
| Fresh clone: `git clone`, then `python scripts/dev.py setup` | 41 s on a fresh clone. It created `.env` with a random secret, `backend/.venv` and `node_modules`. |
| Fresh clone: `python scripts/dev.py` (same as `make dev`) | The app answered on http://localhost:5173 and `/api/health` answered through the Vite proxy. A WW1 question streamed `status`, `progress` ×6 and `result`. |
| Production smoke test: `make build`, then the API serving `frontend/dist` | 9 of 9 checks passed: the app is served with a CSP, static files are gzipped, the MapLibre worker is served as JavaScript, SSE isn't gzipped, `/m/{slug}` has Open Graph tags, saved maps load, and a repeat question is a zero-token cache hit. |

All runs used `LLM_MODE=mock` and `AUTH_MODE=mock`. The browser walk and the smoke test each started their
own servers with a temporary database.

## Acceptance criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | With `LLM_MODE=mock` and `AUTH_MODE=mock`, the full flow works with no API key and no Google setup | **Pass** | The fresh-clone run, and the whole browser walk (shots 01-37), which uses no key and no Google project. |
| 2 | With a real key, "deaths per country in WW1" gives a map in reasonable time, with sensible grey and coloured countries and notes on defunct states | **Needs your API key** | Not possible here: there is no `ANTHROPIC_API_KEY`. The request shape, streaming, salvage, refusal and error handling are tested against a fake SDK stream (`test_llm_client.py`). The UI for this map, fed by the mock fixture, is in `04-map-ww1.jpg`. See [Still to verify](#still-to-verify). |
| 3 | The 4th anonymous query opens the Access modal. Google sign-in leads to the API-key step. Saving a valid key resumes the blocked query, and a reload keeps a remembered key | **Pass** (mock Google) | Browser walk: after three counted maps (WW1, rainfall, and an unmappable poem, which counts by design), the 4th question opens step 1 (`19-access-step1-signed-out`). "Continue with Google" goes through the full redirect and returns to step 2 (`20-access-step2-add-key`). Checks: *"the blocked question resumed after saving the key"* (`21-byok-map-resumed`) and *"a remembered key survives a reload"* (`24-reload-keeps-key`). Backend: `test_fourth_free_attempt_is_429_with_reset_at`. |
| 4 | A signed-in user with no key still hits the 3/day limit | **Pass** | `test_signed_in_without_key_still_has_three_per_day`, `test_signing_in_does_not_reset_quota` |
| 5 | The Settings modal opens from the top-right button signed out and signed in, every tab works, and it is keyboard accessible | **Pass** | All six tabs signed out (`17-settings-*`). Signed in: `22-settings-account-signed-in`, `23-settings-api-key-connected` and `31-settings-api-key-invalid`. Phone list-to-detail: `36`, `37`. Keyboard: ARIA tabs with ↑/↓, focus trap, `aria-modal`. Check: *"Esc returns focus to the Settings button"*. |
| 6 | A repeated query is served from cache with zero token usage | **Pass** | `test_repeat_query_is_cached_with_zero_tokens_and_no_quota` (a reworded repeat, "WWI"), `test_cache_hits_still_work_when_over_quota`. The production smoke test returned `{"cached": true, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}`. |
| 7 | Changing palette or binning doesn't hit the LLM | **Pass** | Browser check: *"palette and binning changes make no POST /api/maps"* (`08`-`10`). `test_rebin_and_get_do_not_call_llm_or_use_quota` |
| 8 | The benchmark doc exists, with a justified retrieval decision | **Pass**, with projected A/B numbers | [RETRIEVAL_BENCHMARK.md](RETRIEVAL_BENCHMARK.md) gives the tier decision and the reasons for it. Strategy C (World Bank) was measured live: it matched all 9 questions its catalog covers, with no false matches on the other 11, in about 150 ms, for $0. Strategies A and B are projected from token counts until `make bench` runs with a key. |
| 9 | The visual verification routine has run, with screenshots in `docs/screenshots/` and no unresolved console errors or layout problems | **Pass** | 42 screenshots at 1440, 820 and 390 px. Every issue found in the Phase 4 and 5 reviews was fixed and re-shot ([DECISIONS](DECISIONS.md) D-33 to D-36). Re-run for this record: no console errors. |

## The tests section 8 asks for

| Spec item | Tests (`backend/tests/`, unless noted) |
|---|---|
| Schema validation | `test_llm_contract.py`: `test_schema_uses_only_structured_output_features`, `test_meta_comes_first_and_everything_is_required`, `test_meta_is_lenient`, `test_row_coercion`, `test_row_rejects_bad_values`. Also `test_non_payloads_raise`, `test_unmappable_and_categorical_and_empty`. |
| ISO code filtering | `test_unknown_iso_codes_are_dropped`, `test_code_aliases_and_iso2_are_normalized`, `test_duplicates_keep_the_first_row`, `test_dataset_files_are_in_sync_and_keyed` |
| N/A fill | `test_fill_all_covers_every_canonical_country_in_order`, `test_invalid_values_are_dropped_not_zeroed` |
| Binning: quantile | `test_quantile_default_seven_classes_equal_counts`, `test_heavy_ties_reduce_quantile_classes` |
| Binning: equal | `test_equal_interval_edges_and_outlier` |
| Binning: log | `test_log_bins_are_geometric_and_zeros_join_lowest`, `test_log_with_negatives_falls_back_to_quantile` |
| Binning: all-equal values, single value | `test_all_equal_values_make_one_class`, `test_single_value` |
| Binning: outliers | `test_outliers_with_quantile_keep_classes_populated`, `test_equal_interval_edges_and_outlier` |
| Rolling-window limiter | `test_rolling_window_counts_only_last_24h`, `test_blocked_until_oldest_counted_event_expires`, `test_fourth_free_attempt_is_429_with_reset_at` |
| Cookie-clearing bypass attempt | `test_clearing_cookies_does_not_reset_quota`, `test_any_dimension_at_limit_blocks` |
| Quota not charged on cache hit or error | `test_repeat_query_is_cached_with_zero_tokens_and_no_quota`, `test_cache_hits_still_work_when_over_quota`, `test_llm_errors_do_not_count`, `test_empty_result_is_an_uncounted_error` |
| Cache normalization | `test_normalization_merges_trivial_variants`, `test_normalization_keeps_different_questions_apart`, `test_cache_ttl_depends_on_recency` |
| Rebin endpoint | `test_rebin_and_get_do_not_call_llm_or_use_quota` |
| Google login and callback, `AUTH_MODE=mock` | `test_mock_google_login_and_callback`, `test_callback_rejects_bad_state_and_open_redirects`. Real mode against stubbed Google endpoints: the six tests in `test_google_oauth.py` (PKCE S256, `state`, `nonce`, ID-token claims, cancel and failure paths, refusing a weak secret). |
| Session cookie flags | `test_session_cookie_flags`, `test_visitor_cookie_flags`, `test_logout_clears_session` |
| Anonymous-to-account claim of maps | `test_anonymous_maps_and_history_are_claimed_on_sign_in` |
| Quota not reset by signing in | `test_signing_in_does_not_reset_quota` |
| 403 for `X-Anthropic-Key` without a session | `test_byok_requires_session` |
| Account deletion removes all rows | `test_account_deletion_removes_all_rows` |
| BYOK key never in logs | `test_byok_key_never_appears_in_logs_responses_or_db` (a sentinel key goes through the success and error paths, then logs, responses and every database row are scanned), `test_redaction_filter_scrubs_messages_args_and_tracebacks` |
| Frontend tests (`frontend/src/**/*.test.ts`) | Palettes: OKLab interpolation, reversing, ≥2:1 contrast on the canvas, N/A distinct. Number formatting and the countdown. The SSE parser across chunk boundaries. Key storage: `localStorage` vs `sessionStorage`, and storage that throws. CSV formula neutralising. |

Also covered, beyond the list: unmappable answers count (`test_unmappable_counts_against_quota`); the
budget breaker blocks the free tier but not BYOK; one request in flight (409); the per-minute rate
limit; the CSRF header; query length and control characters; proxy headers only when trusted; BYOK is
unlimited and uncounted; World Bank maps are free; truncated output is salvaged with a caveat; upstream
error text is never echoed; the cached system prompt is byte-stable and above the minimum cacheable
length; and production serving (`test_spa.py`).

## Still to verify

These need things only you have. Each takes a few minutes.

1. **The real-key WW1 map** (criterion 2) **and measured A/B numbers.** Put `LLM_MODE=live` and
   `ANTHROPIC_API_KEY=sk-ant-…` in `.env`, run `make dev`, and ask *"How many deaths were there in each
   country in World War 1?"*. Expect about 20-30 coloured countries and the rest grey, with notes on
   successor states (for example, Russia noted as the Russian Empire, Austria as Austria-Hungary) and a
   caveat about historical borders. The projected cost is under $0.002. Then `make bench` runs all 20
   benchmark questions, including this one against curated ranges, and rewrites the results in
   RETRIEVAL_BENCHMARK.md. It stops before $1.
2. **Real Google sign-in.** Create the OAuth client as the [README](../README.md#google-sign-in) describes,
   set `AUTH_MODE=google` with the client ID and secret, and sign in once. The flow's security checks are
   tested against stubbed Google endpoints, but not against Google itself.
3. **Postgres** (optional). SQLAlchemy supports it through `DATABASE_URL`, but only SQLite was exercised.
