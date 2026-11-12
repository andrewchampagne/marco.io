"""Incremental scanner for the streamed map JSON.

It does two jobs as text arrives from the model:
  * counts completed rows, so the UI can show "Gathering data · 87 countries";
  * remembers where the last complete row ended, so a response cut off at `max_tokens` can be
    salvaged into `{"meta": ..., "rows": [complete rows]}` instead of being thrown away.

It tracks JSON string/escape state and nesting depth, so brackets inside notes never confuse it.
Depth 1 is the root object, depth 2 the `rows` array (or the `meta` object), depth 3 a single row.
"""

from __future__ import annotations

import json
from typing import Any


class MapStreamScanner:
    def __init__(self) -> None:
        self._parts: list[str] = []
        self._pos = 0  # absolute index of the next character to scan
        self._root_start = -1
        self._depth = 0
        self._in_str = False
        self._esc = False
        self._str_start = -1
        self._last_string = ""
        self._current_key = ""
        self._rows_open = -1  # index of the '[' that opens `rows`
        self._in_rows = False
        self._last_row_end = -1  # index just past the last complete row's ']'
        self.rows_done = 0

    @property
    def text(self) -> str:
        return "".join(self._parts)

    def feed(self, chunk: str) -> int:
        """Scan another chunk; returns the number of complete rows seen so far."""
        if not chunk:
            return self.rows_done
        base = self._pos
        self._parts.append(chunk)
        self._pos += len(chunk)
        text = None  # materialized lazily, only when a key string needs slicing
        for offset, ch in enumerate(chunk):
            i = base + offset
            if self._in_str:
                if self._esc:
                    self._esc = False
                elif ch == "\\":
                    self._esc = True
                elif ch == '"':
                    self._in_str = False
                    if self._depth == 1:
                        text = text or self.text
                        self._last_string = text[self._str_start + 1 : i]
                continue
            if ch == '"':
                self._in_str = True
                self._str_start = i
            elif ch == ":" and self._depth == 1:
                self._current_key = self._last_string
            elif ch in "[{":
                if self._root_start < 0 and ch == "{":
                    self._root_start = i
                self._depth += 1
                if ch == "[" and self._depth == 2 and self._current_key == "rows":
                    self._rows_open = i
                    self._in_rows = True
            elif ch in "]}":
                self._depth -= 1
                if ch == "]" and self._in_rows:
                    if self._depth == 2:
                        self._last_row_end = i + 1
                        self.rows_done += 1
                    elif self._depth == 1:
                        self._in_rows = False
        return self.rows_done

    def result(self) -> tuple[dict[str, Any] | None, bool]:
        """(payload, salvaged). Parses the full text, or salvages complete rows from a truncated one."""
        text = self.text.strip()
        if not text:
            return None, False
        try:
            value = json.loads(text)
            return (value if isinstance(value, dict) else None), False
        except json.JSONDecodeError:
            pass
        return self._salvage(), True

    def _salvage(self) -> dict[str, Any] | None:
        if self._root_start < 0 or self._rows_open < 0:
            return None  # cut off before `rows` began: meta itself may be incomplete
        text = self.text
        end = self._last_row_end if self._last_row_end > 0 else self._rows_open + 1
        candidate = text[self._root_start : end] + "]}"
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            return None
        return value if isinstance(value, dict) and isinstance(value.get("meta"), dict) else None


def parse_map_json(text: str) -> tuple[dict[str, Any] | None, bool]:
    """Parse (or salvage) a complete map JSON string in one go."""
    scanner = MapStreamScanner()
    scanner.feed(text)
    return scanner.result()
