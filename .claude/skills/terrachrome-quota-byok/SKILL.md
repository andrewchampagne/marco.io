---
name: terrachrome-quota-byok
description: Terrachrome's free-tier quota, cost-control and bring-your-own-key (BYOK) rules. Use this whenever you touch quota, rate-limit, budget, identity, session, auth or key-validation code, the /api/maps, /api/usage, /api/key/validate or /api/me endpoints, the usage_events table, logging, the Access modal, the API Key settings tab, or browser key storage - anything where a mistake could let someone bypass or reset the free limit, run up spend, or leak a user's OpenAI or Anthropic key.
---

# Terrachrome quota, budget and BYOK rules

The free tier is cheap but public, so the rules are written to resist bypass (clearing cookies, signing
in, probing) and to keep users' keys out of anything we store.

## Free quota: 3 maps per rolling 24 h

* **Three dimensions are counted separately:** the signed visitor cookie (`client_hash`), the salted IP
  hash (`ip_hash`), and the signed-in `user_id`. A request is blocked if **any** of them is at its limit
  (`used = max(...)`). The per-IP limit has its own setting (`FREE_MAPS_PER_IP_PER_DAY`) because NATs
  such as campuses share one IP.
* **What counts:** a free-tier LLM call that ended `ok` or `unmappable`, including refusals (they would
  otherwise be a free probe).
* **What doesn't count:** cache hits, World Bank (strategy C) maps, server or LLM errors, rebinning, and
  BYOK calls.
* `reset_at` is the moment a slot frees: the oldest counted event still in the window, plus 24 h.
* **Signing in never resets the window.** On sign-in, claim the visitor's anonymous maps, history and
  usage events (set `user_id`), and keep enforcing by IP hash. Signed in without a key, the limit is
  still 3 per 24 h.
* The 4th attempt returns **429 `{code: "quota_exceeded", reset_at, signed_in, used, limit}`** before any
  streaming starts. Per-minute limits use 429 `{code: "rate_limited"}`, which the frontend must not
  confuse with the quota.

## Cost controls

* Budget breaker: if free-tier `cost_est` for the current UTC day is at or above `DAILY_BUDGET_USD`,
  return a friendly **503 `{code: "budget_exhausted"}`**. BYOK keeps working.
* Abuse limits: queries are capped at 200 characters with control characters stripped; output is capped
  at `MAX_OUTPUT_TOKENS` (4000); the model is fixed; each client gets one request in flight (409
  `in_flight`); per-minute rate limits apply to every endpoint; the free tier gets no tools.
* Never store raw IPs: `ip_hash = HMAC(salt, ip)`. Proxy headers are trusted only with
  `TRUST_PROXY_HEADERS=true`.

## BYOK

* Two providers: OpenAI (the default in the UI) and Anthropic. The key arrives only in its provider's
  header, **`X-OpenAI-Key`** or **`X-Anthropic-Key`** (`app/byok.py::read_byok`); both at once is a 400
  `ambiguous_key`. The header picks the provider; never route by sniffing the key. Without a signed-in
  session either header is a **403 `{code: "signin_required"}`**, checked before anything else.
* Free-tier maps use the server's `LLM_PROVIDER` (OpenAI by default); BYOK maps use the key's provider
  (`app/llm/router.py`).
* **Never persist or log the key.** Keep it out of the DB, logs, error bodies and exception messages.
  `ByokKey` hides the key from `repr`. A root logging filter redacts `sk-ant-…`, `sk-proj-…`,
  `sk-svcacct-…` and legacy `sk-…`, and `map_api_error` / `map_openai_error` use fixed messages. Tests
  send a sentinel key for each provider through the success and error paths and grep logs, responses and
  every DB row for it. Keep those tests passing.
* Validation (`POST /api/key/validate`): Anthropic makes a 1-token call on `MODEL_ID`; OpenAI retrieves
  `OPENAI_MODEL_ID` (no tokens). Results map to valid, invalid_key, no_credit or unavailable.
* BYOK is unlimited, but still bound by `max_tokens` and the per-minute limits, and it may use web
  search (strategy B).
* Browser side: the key goes in `localStorage` if "remember on this device" is checked, otherwise in
  `sessionStorage`. The UI has a "Remove key" button and says plainly that the key stays in the browser.

## Accounts

`DELETE /api/me` deletes the user and all their maps, history and usage rows. Session and visitor
cookies are signed, `HttpOnly`, `Secure` (configurable only for Safari localhost) and `SameSite=Lax`,
with a max-age.

## After any change here

Run `cd backend && .venv/Scripts/python -m pytest -k "quota or byok or session or auth or budget"`, then the
full suite.
