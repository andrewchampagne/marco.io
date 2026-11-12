"""Offline token estimates, used by mock mode and the benchmark's cost projections.

These are heuristics, not tokenizer output: real counts come from the API's `usage` (or the free
count_tokens endpoint, which needs a key). Calibration notes:
  * English prose runs about 3.9 characters per token on older Claude tokenizers, and Haiku 5.5's
    tokenizer produces about 30% more tokens for the same text (model migration guide);
  * compact JSON rows such as ["AFG",327,"h"], are punctuation- and code-heavy: about 2.2 characters
    per token after the same adjustment;
  * the canonical country list ("ABW Aruba (NLD)") sits in between.
"""

from __future__ import annotations

import json
from typing import Any

TOKENIZER_FACTOR = 1.3  # Haiku 5.5 vs Haiku 4.5, same text
PROSE_CHARS_PER_TOKEN = 3.9
LIST_CHARS_PER_TOKEN = 2.6
JSON_CHARS_PER_TOKEN = 2.2


def estimate_prompt_tokens(rules: str, country_list: str) -> int:
    prose = len(rules) / PROSE_CHARS_PER_TOKEN * TOKENIZER_FACTOR
    listing = len(country_list) / LIST_CHARS_PER_TOKEN * TOKENIZER_FACTOR
    return int(prose + listing)


def estimate_output_tokens(payload: dict[str, Any]) -> int:
    return int(len(json.dumps(payload, ensure_ascii=False, separators=(",", ":"))) / JSON_CHARS_PER_TOKEN)


def estimate_text_tokens(text: str) -> int:
    return int(len(text) / PROSE_CHARS_PER_TOKEN * TOKENIZER_FACTOR)
