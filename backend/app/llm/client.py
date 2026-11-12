"""One LLM call per map.

Strategy A (default, free tier): JSON outputs (`output_config.format`) with the cached system prompt,
no tools, and thinking off.
Strategy B (BYOK, or the ADMIN_WEB_SEARCH flag): the same prompt, plus the `web_search` server tool
(capped by `max_uses`) and the strict `emit_map` tool. The model searches only when the data is recent,
so this is still one request; `pause_turn` continuations stay inside the same turn.

API keys are never logged or echoed: error messages here are fixed strings, not upstream text.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import anthropic

from ..config import Settings
from .contract import EMIT_MAP_TOOL, MAP_SCHEMA
from .jsonstream import MapStreamScanner, parse_map_json
from .profiles import ModelProfile, estimate_cost_usd, profile_for
from .prompt import WEB_SEARCH_ADDENDUM, system_prompt, user_turn

log = logging.getLogger(__name__)

ProgressFn = Callable[[int], Awaitable[None]]
ThinkingMode = Literal["off", "adaptive"]
MAX_PAUSE_CONTINUATIONS = 2
MAX_SOURCES = 8


class LLMError(Exception):
    """A failed generation. `code` is stable and safe to show; `message` never contains secrets."""

    def __init__(self, code: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    web_searches: int = 0

    def add_from(self, usage: Any) -> None:
        if usage is None:
            return
        self.input_tokens += getattr(usage, "input_tokens", 0) or 0
        self.output_tokens += getattr(usage, "output_tokens", 0) or 0
        self.cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0) or 0
        self.cache_write_tokens += getattr(usage, "cache_creation_input_tokens", 0) or 0
        server = getattr(usage, "server_tool_use", None)
        self.web_searches += (getattr(server, "web_search_requests", 0) or 0) if server else 0

    @property
    def prompt_tokens(self) -> int:
        return self.input_tokens + self.cache_read_tokens + self.cache_write_tokens


@dataclass
class LLMResult:
    payload: dict[str, Any] | None
    usage: Usage
    cost_usd: float
    model: str
    strategy: str  # "A" (knowledge only) or "B" (web search available)
    stop_reason: str | None
    salvaged: bool = False
    refusal: bool = False
    sources: list[dict[str, str]] = field(default_factory=list)
    latency_ms: int = 0


class MapGenerator(Protocol):
    model_id: str

    async def generate(
        self,
        query: str,
        *,
        api_key: str | None = None,
        web_search: bool = False,
        on_progress: ProgressFn | None = None,
    ) -> LLMResult: ...


def refusal_payload() -> dict[str, Any]:
    """What a safety decline becomes: an unmappable result (it counts against quota, like probing)."""
    return {
        "meta": {
            "status": "unmappable",
            "reason": "This request can't be turned into a map.",
            "suggestions": ["Population by country", "Average annual rainfall by country"],
        },
        "rows": [],
    }


class AnthropicMapGenerator:
    def __init__(self, settings: Settings, *, model_id: str | None = None, thinking: ThinkingMode = "off"):
        self.settings = settings
        self.model_id = model_id or settings.model_id
        self.profile: ModelProfile = profile_for(self.model_id)
        self.thinking = thinking
        self._server_client: anthropic.AsyncAnthropic | None = None

    # -- clients -----------------------------------------------------------------------------
    def _server(self) -> anthropic.AsyncAnthropic:
        if self._server_client is None:
            key = self.settings.anthropic_api_key
            if key is None or not key.get_secret_value().strip():
                raise LLMError(
                    "llm_unconfigured",
                    "The server has no Anthropic API key configured. Add your own key in Settings.",
                )
            self._server_client = anthropic.AsyncAnthropic(
                api_key=key.get_secret_value(), max_retries=2, timeout=self.settings.llm_timeout_seconds
            )
        return self._server_client

    async def aclose(self) -> None:
        if self._server_client is not None:
            await self._server_client.close()
            self._server_client = None

    # -- public ------------------------------------------------------------------------------
    async def generate(
        self,
        query: str,
        *,
        api_key: str | None = None,
        web_search: bool = False,
        on_progress: ProgressFn | None = None,
    ) -> LLMResult:
        started = time.perf_counter()
        byok = api_key is not None
        client = (
            anthropic.AsyncAnthropic(api_key=api_key, max_retries=1, timeout=self.settings.llm_timeout_seconds)
            if byok
            else self._server()
        )
        try:
            if web_search:
                result = await self._generate_with_search(client, query, on_progress)
            else:
                result = await self._generate_json(client, query, on_progress)
        except LLMError:
            raise
        except anthropic.APIError as exc:
            raise map_api_error(exc, byok=byok) from None
        except ValueError:
            # The SDK raises ValueError for tool-input JSON it cannot parse at all (eager streaming).
            raise LLMError("bad_output", "The model returned an unreadable result. Please try again.",
                           retryable=True) from None
        finally:
            if byok:
                await client.close()
        result.latency_ms = int((time.perf_counter() - started) * 1000)
        return result

    # -- request building ----------------------------------------------------------------------
    def _cached_system(self) -> list[dict[str, Any]]:
        return [{"type": "text", "text": system_prompt(), "cache_control": {"type": "ephemeral"}}]

    def _output_config(self, *, effort: str | None) -> dict[str, Any]:
        effort = effort or self.settings.llm_effort or self.profile.fallback_effort
        return {"effort": effort} if effort else {}

    def _finish(self, payload, usage: Usage, stop_reason, *, strategy, salvaged, sources=None) -> LLMResult:
        refusal = stop_reason == "refusal"
        if refusal:
            payload, salvaged = refusal_payload(), False
        cost = estimate_cost_usd(
            self.profile,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cache_read_tokens=usage.cache_read_tokens,
            cache_write_tokens=usage.cache_write_tokens,
            web_searches=usage.web_searches,
        )
        return LLMResult(
            payload=payload, usage=usage, cost_usd=cost, model=self.model_id, strategy=strategy,
            stop_reason=stop_reason, salvaged=salvaged, refusal=refusal, sources=sources or [],
        )

    # -- strategy A ----------------------------------------------------------------------------
    async def _generate_json(self, client, query: str, on_progress: ProgressFn | None) -> LLMResult:
        params: dict[str, Any] = {
            "model": self.model_id,
            "max_tokens": self.settings.max_output_tokens,
            "system": self._cached_system(),
            "messages": [{"role": "user", "content": user_turn(query)}],
        }
        if self.thinking == "adaptive":
            params["thinking"] = {"type": "adaptive"}
            output_config = self._output_config(effort="low")
        else:
            if self.profile.thinking_off is not None:
                params["thinking"] = self.profile.thinking_off
            output_config = self._output_config(effort=None)
        output_config["format"] = {"type": "json_schema", "schema": MAP_SCHEMA}
        params["output_config"] = output_config

        scanner = MapStreamScanner()
        reported = -1
        async with client.messages.stream(**params) as stream:
            async for event in stream:
                if event.type == "text":
                    rows = scanner.feed(event.text)
                    if on_progress and rows != reported and (rows - reported >= 5 or rows < 5):
                        reported = rows
                        await on_progress(rows)
            final = await stream.get_final_message()

        usage = Usage()
        usage.add_from(final.usage)
        payload, salvaged = scanner.result()
        if payload is None and final.stop_reason != "refusal":
            text = "".join(b.text for b in final.content if getattr(b, "type", "") == "text")
            payload, salvaged = parse_map_json(text)
        if payload is None and final.stop_reason != "refusal":
            raise LLMError("bad_output", "The model returned an unreadable result. Please try again.", retryable=True)
        return self._finish(payload, usage, final.stop_reason, strategy="A", salvaged=salvaged)

    # -- strategy B ----------------------------------------------------------------------------
    async def _generate_with_search(self, client, query: str, on_progress: ProgressFn | None) -> LLMResult:
        tools = [
            {"type": self.settings.web_search_tool, "name": "web_search",
             "max_uses": self.settings.web_search_max_uses},
            {**EMIT_MAP_TOOL, "eager_input_streaming": True},
        ]
        system = [*self._cached_system(), {"type": "text", "text": WEB_SEARCH_ADDENDUM}]
        messages: list[dict[str, Any]] = [{"role": "user", "content": user_turn(query)}]
        usage = Usage()
        blocks: list[Any] = []
        emit_partial: dict[int, MapStreamScanner] = {}
        stop_reason = None
        reported = -1

        for _ in range(1 + MAX_PAUSE_CONTINUATIONS):
            params: dict[str, Any] = {
                "model": self.model_id,
                "max_tokens": self.settings.max_output_tokens,
                "system": system,
                "tools": tools,
                "tool_choice": {"type": "auto"},
                "messages": messages,
                "output_config": self._output_config(effort="low"),
            }
            block_kinds: dict[int, str] = {}
            async with client.messages.stream(**params) as stream:
                async for event in stream:
                    if event.type == "content_block_start":
                        cb = event.content_block
                        kind = getattr(cb, "type", "")
                        if kind == "tool_use" and getattr(cb, "name", "") == "emit_map":
                            block_kinds[event.index] = "emit_map"
                            emit_partial[event.index] = MapStreamScanner()
                    elif event.type == "content_block_delta" and block_kinds.get(event.index) == "emit_map":
                        delta = event.delta
                        if getattr(delta, "type", "") == "input_json_delta":
                            rows = emit_partial[event.index].feed(delta.partial_json)
                            if on_progress and rows != reported and (rows - reported >= 5 or rows < 5):
                                reported = rows
                                await on_progress(rows)
                final = await stream.get_final_message()
            usage.add_from(final.usage)
            blocks.extend(final.content)
            stop_reason = final.stop_reason
            if stop_reason != "pause_turn":
                break
            messages = [*messages, {"role": "assistant", "content": final.content}]

        sources = collect_sources(blocks)
        if stop_reason == "refusal":
            return self._finish(None, usage, stop_reason, strategy="B", salvaged=False, sources=sources)

        payload, salvaged = None, False
        emit_blocks = [b for b in blocks if getattr(b, "type", "") == "tool_use" and getattr(b, "name", "") == "emit_map"]
        if emit_blocks:
            if stop_reason == "max_tokens" and emit_partial:
                # The final tool input may be a silently truncated object; rebuild from the raw stream.
                payload, salvaged = list(emit_partial.values())[-1].result()
            else:
                candidate = emit_blocks[-1].input
                payload = candidate if isinstance(candidate, dict) else None
        if payload is None:
            text = "".join(b.text for b in blocks if getattr(b, "type", "") == "text")
            payload, salvaged = parse_map_json(text[text.find("{"):] if "{" in text else "")
        if payload is None:
            raise LLMError("bad_output", "The model didn't return a map. Please try again.", retryable=True)
        return self._finish(payload, usage, stop_reason, strategy="B", salvaged=salvaged, sources=sources)


def collect_sources(blocks: list[Any]) -> list[dict[str, str]]:
    """Unique (url, title) pairs from web search results, shown in the map's info popover."""
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for block in blocks:
        if getattr(block, "type", "") != "web_search_tool_result":
            continue
        content = getattr(block, "content", None)
        if not isinstance(content, list):  # an error object, not results
            continue
        for item in content:
            url = getattr(item, "url", None)
            if url and url not in seen:
                seen.add(url)
                out.append({"url": url, "title": (getattr(item, "title", "") or url)[:140]})
    return out[:MAX_SOURCES]


def map_api_error(exc: anthropic.APIError, *, byok: bool) -> LLMError:
    """Translate SDK exceptions into stable codes. Never copies upstream text, which keeps keys out."""
    if isinstance(exc, anthropic.AuthenticationError):
        if byok:
            return LLMError("invalid_key", "Your Anthropic API key was rejected. Check it in Settings.")
        log.error("Server Anthropic API key was rejected (401)")
        return LLMError("llm_unavailable", "The map service is temporarily unavailable.", retryable=True)
    if isinstance(exc, anthropic.PermissionDeniedError):
        if byok:
            return LLMError("invalid_key", "Your Anthropic API key isn't allowed to use this model.")
        return LLMError("llm_unavailable", "The map service is temporarily unavailable.", retryable=True)
    if isinstance(exc, anthropic.RateLimitError):
        return LLMError("llm_rate_limited", "The AI service is busy right now. Try again in a minute.", retryable=True)
    if isinstance(exc, anthropic.BadRequestError):
        text = str(getattr(exc, "message", "")).lower()
        if "credit" in text or "billing" in text:
            if byok:
                return LLMError("no_credit", "Your Anthropic account has no remaining credit.")
            log.error("Server Anthropic account is out of credit")
            return LLMError("llm_unavailable", "The map service is temporarily unavailable.", retryable=True)
        log.error("Anthropic rejected the map request (400): %s", type(exc).__name__)
        return LLMError("llm_bad_request", "The AI service rejected this request.")
    if isinstance(exc, anthropic.APITimeoutError):
        return LLMError("llm_timeout", "The AI service took too long. Please try again.", retryable=True)
    if isinstance(exc, anthropic.APIConnectionError):
        return LLMError("llm_unavailable", "Couldn't reach the AI service. Please try again.", retryable=True)
    return LLMError("llm_unavailable", "The AI service had a problem. Please try again.", retryable=True)
