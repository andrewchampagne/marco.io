"""OpenAIMapGenerator against a scripted fake Responses stream: request shape, parsing, usage/cost,
salvage, refusals, web search, the search-rejected fallback, error mapping, and the provider router."""

import asyncio
import json
from types import SimpleNamespace as NS

import httpx2
import openai
import pytest

from app.config import Settings
from app.llm.client import LLMError
from app.llm.contract import MAP_SCHEMA
from app.llm.mock import MockMapGenerator
from app.llm.openai_client import OpenAIMapGenerator, map_openai_error, usage_from_openai
from app.llm.router import ProviderRouter

PAYLOAD = {
    "meta": {"status": "ok", "reason": "", "title": "Test", "caveats": []},
    "rows": [["FRA", 1397800, "m", "French Third Republic"], ["DEU", 2037000, "m"], ["GBR", 886000, "h"]],
}
REQ = httpx2.Request("POST", "https://api.openai.com/v1/responses")


def usage(input_tokens=4900, cached=4800, written=0, output=500):
    return NS(input_tokens=input_tokens, output_tokens=output,
              input_tokens_details=NS(cached_tokens=cached, cache_write_tokens=written),
              output_tokens_details=NS(reasoning_tokens=0))


def final(text="", *, status="completed", reason=None, refusal=None, searches=(), annotations=(), use=None):
    content = []
    if text:
        content.append(NS(type="output_text", text=text,
                          annotations=[NS(type="url_citation", url=u, title=t) for u, t in annotations]))
    if refusal:
        content.append(NS(type="refusal", refusal=refusal))
    output = [NS(type="web_search_call", action=NS(sources=[NS(url=u, title=None) for u in s])) for s in searches]
    output.append(NS(type="message", content=content))
    return NS(status=status, incomplete_details=NS(reason=reason) if reason else None, output=output,
              usage=use or usage())


def events_for(text, done, *, size=19, refusal=False):
    evs = [NS(type="response.created")]
    evs += [NS(type="response.output_text.delta", delta=text[i:i + size]) for i in range(0, len(text), size)]
    if refusal:
        evs.append(NS(type="response.refusal.delta", delta="I can't help with that."))
    kind = {"completed": "response.completed", "incomplete": "response.incomplete"}[done.status]
    evs.append(NS(type=kind, response=done))
    return evs


class FakeResponses:
    def __init__(self, scripted):
        self.scripted = list(scripted)
        self.calls = []

    async def create(self, **params):
        self.calls.append(params)
        item = self.scripted.pop(0)
        if isinstance(item, Exception):
            raise item

        async def gen():
            for event in item:
                yield event
        return gen()


class FakeOpenAI:
    def __init__(self, scripted):
        self.responses = FakeResponses(scripted)

    async def close(self):
        return None


def make(scripted=(), **settings):
    gen = OpenAIMapGenerator(Settings(_env_file=None, llm_mode="live", openai_api_key="test-key", **settings))
    gen._server_client = FakeOpenAI(scripted)
    return gen


def run(coro):
    return asyncio.run(coro)


def test_request_shape_strict_schema_no_reasoning_no_sampling():
    text = json.dumps(PAYLOAD)
    gen = make([events_for(text, final(text))])
    progress = []

    async def on_progress(n):
        progress.append(n)

    result = run(gen.generate("WW1 deaths", on_progress=on_progress))
    params = gen._server_client.responses.calls[0]
    assert params["model"] == "gpt-6-luna"
    assert params["text"]["format"] == {"type": "json_schema", "name": "country_map", "schema": MAP_SCHEMA, "strict": True}
    assert params["reasoning"] == {"effort": "none"}
    assert "temperature" not in params and "top_p" not in params and "tools" not in params
    assert params["max_output_tokens"] == 4000 and params["store"] is False
    assert "<user_query>" in params["input"][0]["content"] and len(params["instructions"]) > 10_000
    assert params["prompt_cache_key"].startswith("terrachrome-map-v")
    assert result.payload["rows"][0][0] == "FRA" and result.strategy == "A" and not result.refusal
    assert progress and progress[-1] == 3


def test_usage_splits_cached_and_written_tokens_and_prices_them():
    u = usage_from_openai(usage(input_tokens=5000, cached=4800, written=0, output=2000))
    assert (u.input_tokens, u.cache_read_tokens, u.cache_write_tokens, u.output_tokens) == (200, 4800, 0, 2000)
    text = json.dumps(PAYLOAD)
    gen = make([events_for(text, final(text, use=usage(input_tokens=5000, cached=0, written=4800, output=2000)))])
    result = run(gen.generate("q"))
    # 200 in @0.10 + 4800 written @0.125 + 2000 out @0.50 per MTok
    assert result.cost_usd == pytest.approx((200 * 0.10 + 4800 * 0.125 + 2000 * 0.50) / 1e6)


def test_truncated_output_is_salvaged():
    text = json.dumps(PAYLOAD)[:-40]
    gen = make([events_for(text, final(text, status="incomplete", reason="max_output_tokens"))])
    result = run(gen.generate("q"))
    assert result.salvaged and result.stop_reason == "max_tokens" and len(result.payload["rows"]) >= 1


def test_refusal_becomes_unmappable():
    gen = make([events_for("", final(refusal="I can't help with that."), refusal=True)])
    result = run(gen.generate("something unsafe"))
    assert result.refusal and result.payload["meta"]["status"] == "unmappable"


def test_unreadable_output_raises():
    gen = make([events_for("not json at all", final("not json at all"))])
    with pytest.raises(LLMError) as exc:
        run(gen.generate("q"))
    assert exc.value.code == "bad_output"


def test_web_search_adds_tool_and_collects_sources():
    text = json.dumps(PAYLOAD)
    done = final(text, searches=[["https://stats.example/a", "https://stats.example/b"]],
                 annotations=[("https://stats.example/a", "Table A"), ("https://wiki.example/c", "List C")])
    gen = make([events_for(text, done)])
    result = run(gen.generate("GDP in 2026", web_search=True))
    params = gen._server_client.responses.calls[0]
    assert params["tools"] == [{"type": "web_search"}] and params["max_tool_calls"] == 3
    assert "web_search_call.action.sources" in params["include"] and "required JSON format" in params["instructions"]
    assert result.strategy == "B" and result.usage.web_searches == 1
    assert [s["url"] for s in result.sources] == ["https://stats.example/a", "https://stats.example/b", "https://wiki.example/c"]
    assert result.cost_usd > 0.01  # the $0.01 search fee is included


def test_search_rejected_with_structured_output_falls_back_to_plain_call():
    text = json.dumps(PAYLOAD)
    rejected = openai.BadRequestError("tools not supported with json_schema", response=httpx2.Response(400, request=REQ), body=None)
    gen = make([rejected, events_for(text, final(text))])
    result = run(gen.generate("q", web_search=True))
    calls = gen._server_client.responses.calls
    assert len(calls) == 2 and "tools" in calls[0] and "tools" not in calls[1]
    assert result.strategy == "A"


def test_missing_server_key_is_a_clear_error():
    gen = OpenAIMapGenerator(Settings(_env_file=None, llm_mode="live", openai_api_key=""))
    with pytest.raises(LLMError) as exc:
        run(gen.generate("q"))
    assert exc.value.code == "llm_unconfigured"


def status_error(cls, status, body=None, message="upstream text sk-proj-SECRETSECRETSECRET"):
    return cls(message, response=httpx2.Response(status, request=REQ), body=body)


@pytest.mark.parametrize("exc,byok,code", [
    (status_error(openai.AuthenticationError, 401), True, "invalid_key"),
    (status_error(openai.AuthenticationError, 401), False, "llm_unavailable"),
    (status_error(openai.NotFoundError, 404), True, "invalid_key"),
    (status_error(openai.RateLimitError, 429, body={"error": {"code": "insufficient_quota"}}), True, "no_credit"),
    (status_error(openai.RateLimitError, 429, body={"error": {"code": "insufficient_quota"}}), False, "llm_unavailable"),
    (status_error(openai.RateLimitError, 429, body={"error": {"code": "rate_limit_exceeded"}}), True, "llm_rate_limited"),
    (status_error(openai.BadRequestError, 400), True, "llm_bad_request"),
    (openai.APITimeoutError(request=REQ), False, "llm_timeout"),
    (openai.APIConnectionError(request=REQ), False, "llm_unavailable"),
])
def test_error_mapping_never_echoes_upstream_text(exc, byok, code):
    err = map_openai_error(exc, byok=byok)
    assert err.code == code
    assert "sk-proj" not in err.message and "SECRET" not in err.message


def test_router_sends_free_tier_to_server_provider_and_byok_to_key_provider():
    class Recorder:
        def __init__(self, name):
            self.name, self.model_id, self.keys = name, f"{name}-model", []

        async def generate(self, query, *, api_key=None, web_search=False, on_progress=None):
            self.keys.append(api_key)
            return self.name

        async def aclose(self):
            return None

    oa, an = Recorder("openai"), Recorder("anthropic")
    router = ProviderRouter(Settings(_env_file=None), {"openai": oa, "anthropic": an})
    assert router.model_id == "openai-model"  # OpenAI is the default provider
    assert run(router.generate("q")) == "openai"
    assert run(router.generate("q", api_key="sk-ant-x", provider="anthropic")) == "anthropic"
    assert run(router.generate("q", api_key="sk-proj-x", provider="openai")) == "openai"
    assert oa.keys == [None, "sk-proj-x"] and an.keys == ["sk-ant-x"]
    router_anthropic = ProviderRouter(Settings(_env_file=None, llm_provider="anthropic"), {"openai": oa, "anthropic": an})
    assert run(router_anthropic.generate("q")) == "anthropic"


def test_mock_generator_labels_maps_with_the_routed_model():
    gen = MockMapGenerator(Settings(_env_file=None, mock_latency_ms=0))
    assert run(gen.generate("Population by country")).model == "gpt-6-luna"
    assert run(gen.generate("Population by country", api_key="sk-ant-" + "a" * 30, provider="anthropic")).model == "claude-haiku-5-5"
    assert gen.providers == ["openai", "anthropic"]
