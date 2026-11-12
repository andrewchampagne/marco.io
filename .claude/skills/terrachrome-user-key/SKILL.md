---
name: terrachrome-user-key
description: Terrachrome's rules for the visitor's own OpenAI API key, rate limits and visitor identity. Use this whenever you touch key handling or key-validation code, the X-OpenAI-Key header, /api/maps or /api/key/validate, the key prompt, the API key settings tab, browser key storage, logging, rate limits, the visitor cookie, or history/export - anything where a mistake could leak a visitor's key or let someone hammer the server.
---

# Terrachrome: the visitor's OpenAI key

There are no accounts, no free tier and no server AI key (docs/DECISIONS.md D-40). Every AI call is paid
for by the visitor's own OpenAI key, which they enter in the browser. The rules below keep that key out
of anything we store and keep the server from being abused.

## The key

* It arrives only in the **`X-OpenAI-Key`** header (`app/llm/keys.py::read_key`), per request. The server
  uses it for that one request (a short-lived OpenAI client) and drops it.
* **Never persist or log it.** Keep it out of the DB, logs, error bodies and exception messages.
  `UserKey` hides it from `repr`. A root logging filter redacts `sk-proj-…`, `sk-svcacct-…` and legacy
  `sk-…`, and `map_openai_error` uses fixed messages. `test_key_never_appears_in_logs_responses_or_db`
  sends a sentinel key through the success and error paths and greps logs, responses and every DB row
  for it. Keep it passing.
* The shape check is loose (`sk-` + 20-400 characters) because OpenAI doesn't publish a key format.
* `POST /api/key/validate` retrieves `OPENAI_MODEL_ID` with the key (no tokens) and maps the result to
  valid, invalid_key, no_credit or unavailable. Mock mode checks only the shape; a key containing
  "invalid" is rejected.
* **Which requests need it:** an AI call does. Cache hits, World Bank maps, saved maps and rebinning
  don't. Without a key, a question that needs the AI gets **401 `{code: "key_required"}`** before any
  streaming (or as the final stream event if a World Bank fetch fails over to the AI). The browser
  then opens the key prompt, and the question runs once the key is saved.
* Browser side: the key goes in `localStorage` if "remember on this device" is checked, otherwise in
  `sessionStorage`, as JSON `{key}`. The UI has "Remove key" and says plainly that the key stays in the
  browser.

## Abuse controls

* Questions are capped at 200 characters with control characters stripped; output is capped at
  `MAX_OUTPUT_TOKENS` (4000); the model is fixed by the server; each visitor gets one request in flight
  (409 `in_flight`); per-minute rate limits apply to every endpoint, stricter on map creation and key
  checks (429 `rate_limited`).
* Never store raw IPs: `ip_hash = HMAC(salt, ip)`, used only for rate limits. Proxy headers are trusted
  only with `TRUST_PROXY_HEADERS=true`.

## Visitor identity

A signed, random visitor cookie (`tc_vid`: `HttpOnly`, `Secure`, `SameSite=Lax`, long max-age) owns the
history drawer and the JSON export. The database sees only an HMAC of it (`client_hash`).

## After any change here

Run `cd backend && .venv/Scripts/python -m pytest tests/test_keys.py tests/test_api_maps.py`, then the full
suite.
