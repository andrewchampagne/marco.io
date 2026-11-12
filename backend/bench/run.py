"""Retrieval benchmark: compare strategies on 20 questions for accuracy, tokens, cost and latency.

Strategies
  A        one structured call (JSON outputs), cached system prompt, model knowledge only, thinking off
  A+think  strategy A with adaptive thinking at low effort
  B        strategy A plus the web search tool (max_uses cap) and the strict emit_map tool
  C        World Bank connector for catalog questions, falling back to A for everything else

Usage (from backend/, with the venv's python):
  python -m bench.run --dry-run            mock model, no key, no spend: exercises the whole harness
  python -m bench.run --strategies C       World Bank only (no key needed; unmatched questions are skipped)
  python -m bench.run                      real run (needs ANTHROPIC_API_KEY): A, A+think, B, C on Haiku 5.5
  python -m bench.run --models claude-haiku-5-5,claude-sonnet-5-5 --strategies A --max-usd 2

Real runs refuse to start without ANTHROPIC_API_KEY, print the worst-case cost first, and stop before
any call that could push spend past --max-usd (default $1.00). Results go to bench/results/*.jsonl and
docs/RETRIEVAL_BENCHMARK.md is regenerated from every results file.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from app.config import Settings
from app.countries import load_countries
from app.datasources.base import DataSourceError
from app.datasources.worldbank import WorldBankSource
from app.llm.client import AnthropicMapGenerator, LLMError, LLMResult
from app.llm.mock import MockMapGenerator
from app.llm.profiles import WEB_SEARCH_USD_PER_SEARCH, profile_for
from app.llm.prompt import system_prompt
from app.processing import PayloadError, clean_payload

from .metrics import evaluate
from .report import write_report

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
ALL_STRATEGIES = ("A", "A+think", "B", "C")
LLM_STRATEGIES = {"A": ("off", False), "A+think": ("adaptive", False), "B": ("off", True)}
B_SEARCH_RESULT_TOKENS = 12_000  # worst-case input tokens per basic web search, for the spend guard


def load_queries(only: str | None) -> list[dict[str, Any]]:
    queries = json.loads((HERE / "queries.json").read_text(encoding="utf-8"))
    if only:
        wanted = {q.strip() for q in only.split(",")}
        queries = [q for q in queries if q["id"] in wanted]
    return queries


def load_truth(name: str | None) -> dict[str, Any] | None:
    if not name:
        return None
    return json.loads((HERE / "ground_truth" / f"{name}.json").read_text(encoding="utf-8"))


def worst_case_usd(model: str, strategy: str, settings: Settings) -> float:
    p = profile_for(model)
    prompt_tokens = len(system_prompt()) // 3 + 200  # pessimistic: ~3 chars per token
    cost = (prompt_tokens * p.cache_write_per_mtok + settings.max_output_tokens * p.output_per_mtok) / 1e6
    if strategy == "B":
        uses = settings.web_search_max_uses
        cost += uses * WEB_SEARCH_USD_PER_SEARCH + uses * B_SEARCH_RESULT_TOKENS * p.input_per_mtok / 1e6
    return cost


def score(query: dict[str, Any], payload: dict[str, Any] | None) -> dict[str, Any]:
    countries = load_countries()
    out: dict[str, Any] = {"valid": False, "status": "error"}
    try:
        cleaned = clean_payload(payload, countries)
    except PayloadError:
        return out
    out.update(valid=True, status=cleaned.status, rows=len(cleaned.rows), dropped=sum(cleaned.dropped.values()),
               caveats=len(cleaned.meta.caveats), recency=cleaned.meta.recency_sensitive)
    expect = query["expect"]
    out["status_ok"] = (cleaned.status == expect) if expect != "any" else cleaned.status in ("ok", "unmappable")
    truth = load_truth(query.get("truth"))
    if truth and cleaned.status == "ok":
        out.update(evaluate(cleaned.values, truth["values"], exclusive=bool(truth.get("exclusive"))))
    return out


def usage_fields(result: LLMResult) -> dict[str, Any]:
    u = result.usage
    return {
        "tokens_in": u.input_tokens, "cache_read": u.cache_read_tokens, "cache_write": u.cache_write_tokens,
        "tokens_out": u.output_tokens, "searches": u.web_searches, "cost_usd": round(result.cost_usd, 6),
        "latency_ms": result.latency_ms, "salvaged": result.salvaged, "stop_reason": result.stop_reason,
        "sources": len(result.sources),
    }


async def run(args: argparse.Namespace) -> Path | None:
    strategies = [s for s in ALL_STRATEGIES if s in args.strategies.split(",")]
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    queries = load_queries(args.queries)
    needs_llm = any(s in LLM_STRATEGIES for s in strategies)
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if needs_llm and not args.dry_run and not key:
        print("Refusing to run: set ANTHROPIC_API_KEY for a real run, or use --dry-run "
              "(or --strategies C for the free World Bank strategy).", file=sys.stderr)
        return None

    mode = "dry-run" if args.dry_run else ("c-only" if not needs_llm else "live")
    base = Settings(
        llm_mode="mock" if args.dry_run else "live",
        anthropic_api_key=key or None,
        max_output_tokens=args.max_tokens,
        mock_latency_ms=0,
    )
    llm_calls = sum(1 for s in strategies if s in LLM_STRATEGIES) * len(queries) * len(models)
    worst = sum(worst_case_usd(m, s, base) for m in models for s in strategies if s in LLM_STRATEGIES) * len(queries)
    print(f"Benchmark ({mode}): {len(queries)} queries x {strategies} x {models}; up to {llm_calls} LLM calls")
    if mode == "live":
        print(f"Worst-case spend ${worst:.2f}; hard cap --max-usd ${args.max_usd:.2f}")

    RESULTS.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    out_path = RESULTS / f"{stamp}-{mode}.jsonl"
    spent = 0.0
    wb = WorldBankSource()
    with out_path.open("w", encoding="utf-8") as out:
        for model in models:
            settings = base.model_copy(update={"model_id": model})
            a_results: dict[str, dict[str, Any]] = {}
            for strategy in strategies:
                gen = None
                if strategy in LLM_STRATEGIES:
                    thinking, _ = LLM_STRATEGIES[strategy]
                    gen = (MockMapGenerator(settings) if args.dry_run
                           else AnthropicMapGenerator(settings, model_id=model, thinking=thinking))
                for q in queries:
                    rec: dict[str, Any] = {"run": stamp, "mode": mode, "model": model, "strategy": strategy,
                                           "query_id": q["id"], "type": q["type"], "query": q["query"]}
                    if strategy == "C":
                        match = wb.match(q["query"])
                        rec["matched"] = match.indicator if match else None
                        if match:
                            try:
                                src = await wb.fetch(match)
                                rec.update(score(q, src.payload))
                                rec.update(cost_usd=0.0, latency_ms=src.latency_ms, tokens_in=0, tokens_out=0,
                                           cache_read=0, cache_write=0, searches=0)
                            except DataSourceError as exc:
                                rec.update(error=f"datasource: {exc}", status="error")
                        elif q["id"] in a_results:
                            rec.update({k: v for k, v in a_results[q["id"]].items() if k not in rec})
                            rec["fallback"] = "A"
                        else:
                            rec.update(status="skipped", note="no catalog match and strategy A not run")
                    else:
                        thinking, web = LLM_STRATEGIES[strategy]
                        guard = worst_case_usd(model, strategy, settings)
                        if mode == "live" and spent + guard > args.max_usd:
                            rec.update(status="skipped", note=f"spend cap ${args.max_usd:.2f} reached")
                            print(f"  {model} {strategy:7} {q['id']}: skipped (spend cap)")
                            out.write(json.dumps(rec) + "\n")
                            continue
                        started = time.perf_counter()
                        try:
                            result = await gen.generate(q["query"], web_search=web)
                            spent += result.cost_usd
                            rec.update(usage_fields(result))
                            rec.update(score(q, result.payload))
                        except LLMError as exc:
                            rec.update(status="error", error=exc.code,
                                       latency_ms=int((time.perf_counter() - started) * 1000))
                        if strategy == "A":
                            a_results[q["id"]] = dict(rec)
                    out.write(json.dumps(rec) + "\n")
                    out.flush()
                    print(f"  {model} {strategy:7} {q['id']}: {rec.get('status')} "
                          f"rows={rec.get('rows', '-')} rho={rec.get('spearman', '-')} "
                          f"cost=${rec.get('cost_usd', 0):.5f} {rec.get('latency_ms', '-')}ms")
                if gen is not None and hasattr(gen, "aclose"):
                    await gen.aclose()
    print(f"Spent ${spent:.4f} (estimated from usage). Results: {out_path}")
    write_report()
    return out_path


def main() -> None:
    ap = argparse.ArgumentParser(description="Terrachrome retrieval benchmark")
    ap.add_argument("--strategies", default="A,A+think,B,C")
    ap.add_argument("--models", default="claude-haiku-5-5")
    ap.add_argument("--queries", default=None, help="comma-separated query ids (default: all 20)")
    ap.add_argument("--max-usd", type=float, default=1.00)
    ap.add_argument("--max-tokens", type=int, default=4000)
    ap.add_argument("--dry-run", action="store_true", help="mock model: no key, no spend")
    args = ap.parse_args()
    if asyncio.run(run(args)) is None:
        sys.exit(2)


if __name__ == "__main__":
    main()
