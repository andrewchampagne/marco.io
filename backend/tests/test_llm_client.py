"""AnthropicMapGenerator against a scripted fake SDK stream: request shape, parsing, salvage, B path."""

import asyncio
import json
from types import SimpleNamespace as NS

import anthropic
import httpx2
import pytest

from app.config import Settings
from app.llm.client import AnthropicMapGenerator, LLMError, map_api_error

PAYLOAD = {
    "meta": {"status": "ok", "reason": "", "title": "Test", "caveats": []},
    "rows": [["FRA", 1397800, "m", "French Third Republic"], ["DEU", 2037000, "m"], ["GBR", 886000, "h"]],
}


def usage(**kw):
    base = dict(input_tokens=40, output_tokens=500, cache_read_input_tokens=4800,
                cache_creation_input_tokens=0, server_tool_use=None)
    base.update(kw)
    return NS(**base)


class FakeStream:
    def __init__(self, events, final):
        self.events, self.final = events, final

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __aiter__(self):
        async def gen():
            for event in self.events:
                yield event
        return gen()

    async def get_final_message(self):
        return self.final


class FakeClient:
    def __init__(self, scripted):
        self.scripted = list(scripted)
        self.calls = []
        self.messages = self

    def stream(self, **params):
        self.calls.append(params)
        events, final = self.scripted.pop(0)
        return FakeStream(events, final)

    async def close(self):
        return None


def text_events(text, size=17):
    return [NS(type="text", text=text[i:i + size]) for i in range(0, len(text), size)]


def make(model="claude-haiku-5-5", scripted=()):
    gen = AnthropicMapGenerator(Settings(llm_mode="live", anthropic_api_key="test-key", model_id=model))
    gen._server_client = FakeClient(scripted)
    return gen


def run(coro):
    return asyncio.run(coro)


def test_strategy_a_request_shape_and_parse():
    text = json.dumps(PAYLOAD)
    final = NS(content=[NS(type="text", text=text)], stop_reason="end_turn", usage=usage())
    gen = make(scripted=[(text_events(text), final)])
    progress = []

    async def on_progress(n):
        progress.append(n)

    result = run(gen.generate("WW1 deaths", on_progress=on_progress))
    params = gen._server_client.calls[0]
    assert params["model"] == "claude-haiku-5-5"
    assert params["thinking"] == {"type": "disabled"}
    assert params["output_config"]["format"]["type"] == "json_schema"
    assert params["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "<user_query>WW1 deaths</user_query>" in params["messages"][0]["content"]
    assert "tools" not in params and "temperature" not in params and "tool_choice" not in params
    assert result.payload == PAYLOAD and result.strategy == "A" and not result.salvaged
    assert result.usage.cache_read_tokens == 4800 and result.usage.output_tokens == 500
    assert result.cost_usd == pytest.approx((40 * 0.10 + 500 * 0.50 + 4800 * 0.01) / 1e6)
    assert progress and progress[-1] == 3


@pytest.mark.parametrize("model,thinking,effort", [
    ("claude-sonnet-5-5", {"type": "between_tools"}, None),
    ("claude-opus-5-5", None, "low"),
])
def test_thinking_off_per_model(model, thinking, effort):
    text = json.dumps(PAYLOAD)
    gen = make(model, [(text_events(text), NS(content=[], stop_reason="end_turn", usage=usage()))])
    run(gen.generate("x"))
    params = gen._server_client.calls[0]
    assert params.get("thinking") == thinking
    assert params["output_config"].get("effort") == effort


def test_strategy_a_salvages_max_tokens_truncation():
    text = json.dumps(PAYLOAD)
    cut = text[: text.index('["GBR"') + 5]
    gen = make(scripted=[(text_events(cut), NS(content=[], stop_reason="max_tokens", usage=usage()))])
    result = run(gen.generate("x"))
    assert result.salvaged and [r[0] for r in result.payload["rows"]] == ["FRA", "DEU"]


def test_refusal_becomes_unmappable():
    gen = make(scripted=[([], NS(content=[], stop_reason="refusal", usage=usage(output_tokens=3)))])
    result = run(gen.generate("x"))
    assert result.refusal and result.payload["meta"]["status"] == "unmappable"


def test_unreadable_output_raises():
    gen = make(scripted=[(text_events("not json"), NS(content=[], stop_reason="end_turn", usage=usage()))])
    with pytest.raises(LLMError) as err:
        run(gen.generate("x"))
    assert err.value.code == "bad_output"


def test_strategy_b_search_pause_turn_and_emit_map():
    search_result = NS(type="web_search_tool_result", content=[NS(url="https://example.org/t", title="Table")])
    first_final = NS(
        content=[NS(type="server_tool_use", name="web_search"), search_result],
        stop_reason="pause_turn",
        usage=usage(server_tool_use=NS(web_search_requests=1), input_tokens=9000),
    )
    raw = json.dumps(PAYLOAD)
    deltas = [NS(type="content_block_delta", index=2, delta=NS(type="input_json_delta", partial_json=raw[i:i + 11]))
              for i in range(0, len(raw), 11)]
    second_events = [NS(type="content_block_start", index=2, content_block=NS(type="tool_use", name="emit_map")), *deltas]
    second_final = NS(content=[NS(type="tool_use", name="emit_map", input=PAYLOAD)], stop_reason="tool_use", usage=usage())
    gen = make(scripted=[([], first_final), (second_events, second_final)])
    progress = []

    async def on_progress(n):
        progress.append(n)

    result = run(gen.generate("latest inflation", web_search=True, on_progress=on_progress))
    first, second = gen._server_client.calls
    tools = {t["name"]: t for t in first["tools"]}
    assert tools["web_search"]["max_uses"] == 3 and tools["web_search"]["type"] == "web_search_20250305"
    assert tools["emit_map"]["strict"] is True and tools["emit_map"]["eager_input_streaming"] is True
    assert first["tool_choice"] == {"type": "auto"} and "format" not in first["output_config"]
    assert second["messages"][-1]["role"] == "assistant"
    assert result.payload == PAYLOAD and result.strategy == "B"
    assert result.usage.web_searches == 1 and result.sources == [{"url": "https://example.org/t", "title": "Table"}]
    assert result.cost_usd > 0.01  # includes the $0.01 search
    assert progress[-1] == 3


REQ = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


@pytest.mark.parametrize("exc,byok,code", [
    (anthropic.AuthenticationError("invalid x-api-key sk-ant-api03-SECRET", response=httpx2.Response(401, request=REQ), body=None), True, "invalid_key"),
    (anthropic.AuthenticationError("bad", response=httpx2.Response(401, request=REQ), body=None), False, "llm_unavailable"),
    (anthropic.BadRequestError("Your credit balance is too low", response=httpx2.Response(400, request=REQ), body=None), True, "no_credit"),
    (anthropic.RateLimitError("slow down", response=httpx2.Response(429, request=REQ), body=None), True, "llm_rate_limited"),
    (anthropic.APIConnectionError(request=REQ), False, "llm_unavailable"),
])
def test_error_mapping_never_echoes_upstream_text(exc, byok, code):
    err = map_api_error(exc, byok=byok)
    assert err.code == code
    assert "sk-ant" not in err.message and "SECRET" not in err.message
