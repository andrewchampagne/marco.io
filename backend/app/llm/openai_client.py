"""The map generator: one OpenAI Responses API call per map, paid with the visitor's own key.

Strategy A: strict Structured Outputs (`text.format` json_schema) with MAP_SCHEMA, reasoning effort from
the model profile (`none` on gpt-6-luna, so no reasoning tokens), streamed so the row counter moves. The
~5K-token static prompt goes in `instructions`, which OpenAI caches automatically (1,024-token minimum); a
fixed `prompt_cache_key` keeps requests on the same cache shard.
Strategy B (WEB_SEARCH_ENABLED, the default): the same request plus the `web_search` tool, capped with
`max_tool_calls`. OpenAI doesn't document combining web search with strict json_schema, so if the API
rejects that pairing (400), the call is retried once as strategy A (docs/DECISIONS.md D-39).

There is no server key: every call uses the key the visitor sent in `X-OpenAI-Key`, with a short-lived
client. API keys are never logged or echoed: error messages here are fixed strings, not upstream text.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from typing import Any

import openai

from ..config import Settings
from ..countries import CountryIndex
from ..regions import Region
from .client import LLMError, LLMResult, ProgressFn, Usage, refusal_payload
from .contract import CONTRACT_VERSION, MAP_SCHEMA, MapMeta
from .gapfill import GAP_FILL_INSTRUCTIONS, gap_fill_input, gap_fill_schema
from .jsonstream import MapStreamScanner, parse_map_json
from .profiles import ModelProfile, estimate_cost_usd, profile_for
from .prompt import WEB_SEARCH_ADDENDUM, system_prompt, user_turn

log = logging.getLogger(__name__)

MAX_SOURCES = 8
TEXT_FORMAT = {"format": {"type": "json_schema", "name": "country_map", "schema": MAP_SCHEMA, "strict": True}}
QUOTA_CODES = {"insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"}


def usage_from_openai(usage: Any) -> Usage:
    """OpenAI's `input_tokens` includes cached reads and cache writes; split them out for pricing."""
    out = Usage()
    if usage is None:
        return out
    details = getattr(usage, "input_tokens_details", None)
    cached = (getattr(details, "cached_tokens", 0) or 0) if details else 0
    written = (getattr(details, "cache_write_tokens", 0) or 0) if details else 0
    total_in = getattr(usage, "input_tokens", 0) or 0
    out.input_tokens = max(0, total_in - cached - written)
    out.cache_read_tokens = cached
    out.cache_write_tokens = written
    out.output_tokens = getattr(usage, "output_tokens", 0) or 0  # includes any reasoning tokens (billed)
    return out


class OpenAIMapGenerator:
    def __init__(self, settings: Settings, *, model_id: str | None = None, effort: str | None = None):
        self.settings = settings
        self.model_id = model_id or settings.openai_model_id
        self.profile: ModelProfile = profile_for(self.model_id)
        self.effort = effort or settings.openai_reasoning_effort or self.profile.reasoning_effort
        # One short-lived client per request, built from the visitor's key (tests swap in a fake).
        self.client_factory: Callable[[str], Any] = lambda key: openai.AsyncOpenAI(
            api_key=key, max_retries=1, timeout=settings.llm_timeout_seconds
        )

    async def aclose(self) -> None:
        return None

    async def generate(
        self,
        query: str,
        *,
        api_key: str | None = None,
        web_search: bool = False,
        on_progress: ProgressFn | None = None,
        region: Region | None = None,
    ) -> LLMResult:
        if not api_key:
            raise LLMError("key_required", "Add your OpenAI API key to make maps.")
        started = time.perf_counter()
        client = self.client_factory(api_key)
        try:
            try:
                result = await self._generate(client, query, web_search=web_search, on_progress=on_progress, region=region)
            except openai.BadRequestError:
                if not web_search:
                    raise
                log.warning("OpenAI rejected web search with structured output; retrying without search")
                result = await self._generate(client, query, web_search=False, on_progress=on_progress, region=region)
        except LLMError:
            raise
        except openai.APIError as exc:
            raise map_openai_error(exc) from None
        finally:
            await client.close()
        result.latency_ms = int((time.perf_counter() - started) * 1000)
        return result

    async def fill_gaps(
        self, query: str, meta: MapMeta, have: list[list[Any]], codes: list[str], countries: CountryIndex,
        *, api_key: str, web_search: bool = False, region_label: str | None = None,
    ) -> LLMResult:
        """The gap-fill pass (see gapfill.py): one small strict-schema call about `codes` only."""
        started = time.perf_counter()
        client = self.client_factory(api_key)
        params: dict[str, Any] = {
            "model": self.model_id,
            "instructions": GAP_FILL_INSTRUCTIONS,
            "input": [{"role": "user", "content": gap_fill_input(query, meta, have, codes, countries, region_label)}],
            "text": {"format": {"type": "json_schema", "name": "country_gap_fill",
                                "schema": gap_fill_schema(codes), "strict": True}},
            "max_output_tokens": self.settings.max_output_tokens,
            "store": False,
        }
        if self.effort:
            params["reasoning"] = {"effort": self.effort}
        if web_search:
            params["tools"] = [{"type": "web_search"}]
            params["tool_choice"] = "auto"
            params["max_tool_calls"] = self.settings.web_search_max_uses
            params["include"] = ["web_search_call.action.sources"]
        try:
            response = await client.responses.create(**params)
        except openai.APIError as exc:
            raise map_openai_error(exc) from None
        finally:
            await client.close()
        usage = usage_from_openai(getattr(response, "usage", None))
        text, sources, searches, _ = read_output(getattr(response, "output", None) or [])
        usage.web_searches = searches
        try:
            payload = json.loads(text) if text else None
        except ValueError:
            payload = None  # incomplete or unreadable: the caller keeps the first pass as it is
        cost = estimate_cost_usd(
            self.profile, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens,
            cache_read_tokens=usage.cache_read_tokens, cache_write_tokens=usage.cache_write_tokens,
            web_searches=usage.web_searches,
        )
        return LLMResult(
            payload=payload, usage=usage, cost_usd=cost, model=self.model_id,
            strategy="B" if web_search else "A", stop_reason=getattr(response, "status", None),
            sources=sources, latency_ms=int((time.perf_counter() - started) * 1000),
        )

    def request_params(self, query: str, *, web_search: bool, region: Region | None = None) -> dict[str, Any]:
        instructions = system_prompt()
        params: dict[str, Any] = {
            "model": self.model_id,
            "instructions": instructions + ("\n" + WEB_SEARCH_ADDENDUM if web_search else ""),
            "input": [{"role": "user", "content": user_turn(query, region=region)}],
            "text": TEXT_FORMAT,
            "max_output_tokens": self.settings.max_output_tokens,
            "prompt_cache_key": f"marco-map-v{CONTRACT_VERSION}",
            "store": False,
        }
        if self.effort:
            params["reasoning"] = {"effort": self.effort}
        if web_search:
            params["tools"] = [{"type": "web_search"}]
            params["tool_choice"] = "auto"
            params["max_tool_calls"] = self.settings.web_search_max_uses
            params["include"] = ["web_search_call.action.sources"]
        return params

    async def _generate(self, client, query: str, *, web_search: bool, on_progress: ProgressFn | None,
                        region: Region | None = None) -> LLMResult:
        scanner = MapStreamScanner()
        reported = -1
        final = None
        refused = False
        stream = await client.responses.create(**self.request_params(query, web_search=web_search, region=region),
                                               stream=True)
        async for event in stream:
            kind = getattr(event, "type", "")
            if kind == "response.output_text.delta":
                rows = scanner.feed(event.delta)
                if on_progress and rows != reported and (rows - reported >= 5 or rows < 5):
                    reported = rows
                    await on_progress(rows)
            elif kind == "response.refusal.delta":
                refused = True
            elif kind in ("response.completed", "response.incomplete", "response.failed"):
                final = event.response
            elif kind == "error":
                raise LLMError("llm_unavailable", "The AI service had a problem. Please try again.", retryable=True)
        if final is None:
            raise LLMError("llm_unavailable", "The AI service ended the response early. Please try again.", retryable=True)
        if getattr(final, "status", "") == "failed":
            raise LLMError("llm_unavailable", "The AI service had a problem. Please try again.", retryable=True)

        usage = usage_from_openai(getattr(final, "usage", None))
        text, sources, searches, refusal_text = read_output(getattr(final, "output", None) or [])
        usage.web_searches = searches
        refused = refused or bool(refusal_text)
        incomplete = getattr(final, "status", "") == "incomplete"
        reason = getattr(getattr(final, "incomplete_details", None), "reason", None)
        stop_reason = "refusal" if refused else ("max_tokens" if incomplete and reason == "max_output_tokens" else "end_turn")

        if refused:
            payload, salvaged = refusal_payload(), False  # a safety decline is an unmappable result
        else:
            payload, salvaged = scanner.result()
            if payload is None and text:
                payload, salvaged = parse_map_json(text[text.find("{"):] if "{" in text else "")
        if payload is None:
            raise LLMError("bad_output", "The model returned an unreadable result. Please try again.", retryable=True)

        cost = estimate_cost_usd(
            self.profile, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens,
            cache_read_tokens=usage.cache_read_tokens, cache_write_tokens=usage.cache_write_tokens,
            web_searches=usage.web_searches,
        )
        return LLMResult(
            payload=payload, usage=usage, cost_usd=cost, model=self.model_id,
            strategy="B" if web_search else "A", stop_reason=stop_reason, salvaged=salvaged,
            refusal=refused, sources=sources,
        )


def read_output(items: list[Any]) -> tuple[str, list[dict[str, str]], int, str]:
    """(text, sources, web search count, refusal text) from a Responses `output` list."""
    texts: list[str] = []
    refusal: list[str] = []
    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    searches = 0

    def add_source(url: str | None, title: str | None) -> None:
        if url and url not in seen and len(sources) < MAX_SOURCES:
            seen.add(url)
            sources.append({"url": url, "title": (title or url)[:140]})

    for item in items:
        kind = getattr(item, "type", "")
        if kind == "web_search_call":
            searches += 1
            for src in getattr(getattr(item, "action", None), "sources", None) or []:
                add_source(getattr(src, "url", None), getattr(src, "title", None))
        elif kind == "message":
            for part in getattr(item, "content", None) or []:
                ptype = getattr(part, "type", "")
                if ptype == "output_text":
                    texts.append(getattr(part, "text", "") or "")
                    for ann in getattr(part, "annotations", None) or []:
                        if getattr(ann, "type", "") == "url_citation":
                            add_source(getattr(ann, "url", None), getattr(ann, "title", None))
                elif ptype == "refusal":
                    refusal.append(getattr(part, "refusal", "") or "")
    return "".join(texts), sources, searches, "".join(refusal)


def _error_code(exc: openai.APIError) -> str | None:
    code = getattr(exc, "code", None)
    if code:
        return str(code)
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        inner = body.get("error", body)
        if isinstance(inner, dict):
            return inner.get("code") or inner.get("type")
    return None


def map_openai_error(exc: openai.APIError) -> LLMError:
    """Translate OpenAI SDK exceptions into stable codes, worded for the visitor whose key was used."""
    code = _error_code(exc)
    if isinstance(exc, openai.AuthenticationError):
        return LLMError("invalid_key", "Your OpenAI API key was rejected. Check it in Settings.")
    if isinstance(exc, openai.PermissionDeniedError):
        return LLMError("invalid_key", "Your OpenAI API key isn't allowed to use this model or region.")
    if isinstance(exc, openai.NotFoundError):
        return LLMError("invalid_key", "Your OpenAI API key can't use the model this app needs.")
    if isinstance(exc, openai.RateLimitError):
        if code in QUOTA_CODES:
            return LLMError("no_credit", "Your OpenAI account has no remaining credit.")
        return LLMError("llm_rate_limited", "OpenAI is rate-limiting your key right now. Try again in a minute.",
                        retryable=True)
    if isinstance(exc, openai.BadRequestError):
        log.error("OpenAI rejected the map request (400): %s", code or type(exc).__name__)
        return LLMError("llm_bad_request", "OpenAI rejected this request.")
    if isinstance(exc, openai.APITimeoutError):
        return LLMError("llm_timeout", "OpenAI took too long. Please try again.", retryable=True)
    if isinstance(exc, openai.APIConnectionError):
        return LLMError("llm_unavailable", "Couldn't reach OpenAI. Please try again.", retryable=True)
    return LLMError("llm_unavailable", "OpenAI had a problem. Please try again.", retryable=True)


async def validate_openai_key(key: str, settings: Settings):
    """GET /v1/models/{model}: checks the key and model access without generating tokens.
    Returns (valid, code, message). Credit problems surface on the first map instead."""
    client = openai.AsyncOpenAI(api_key=key, max_retries=0, timeout=20)
    try:
        await client.models.retrieve(settings.openai_model_id)
        return True, None, ""
    except openai.RateLimitError as exc:
        if _error_code(exc) in QUOTA_CODES:
            return False, "no_credit", "Your OpenAI account has no remaining credit."
        return True, "rate_limited", "Your key works, but it's rate-limited right now."
    except openai.APIError as exc:
        err = map_openai_error(exc)
        if err.code in ("invalid_key", "no_credit"):
            return False, err.code, err.message
        raise LLMError("unavailable", "Couldn't reach OpenAI to check the key. Try again.", retryable=True) from None
    finally:
        await client.close()
