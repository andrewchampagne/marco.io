"""Logging with API-key redaction.

User keys (BYOK) must never reach a log. The code never logs request headers or upstream error text,
and as a backstop every handler gets a filter that rewrites anything shaped like an Anthropic key,
including inside formatted tracebacks.
"""

from __future__ import annotations

import logging
import re

KEY_PATTERN = re.compile(r"sk-ant-[A-Za-z0-9_\-]{4,}")
REDACTED = "sk-ant-[REDACTED]"
QUIET_LOGGERS = ("httpx", "httpx2", "httpcore", "anthropic", "authlib")
APP_LOGGERS = ("", "uvicorn", "uvicorn.error", "uvicorn.access", "fastapi", "app")


def redact(text: str) -> str:
    return KEY_PATTERN.sub(REDACTED, text)


class RedactKeysFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001 - never let logging crash a request
            message = str(record.msg)
        if KEY_PATTERN.search(message):
            record.msg, record.args = redact(message), ()
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = redact(record.exc_text)
        if record.stack_info:
            record.stack_info = redact(record.stack_info)
        return True


_FILTER = RedactKeysFilter()


def _attach(handler: logging.Handler) -> None:
    if _FILTER not in handler.filters:
        handler.addFilter(_FILTER)


def configure_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        root.addHandler(handler)
        root.setLevel(level)
    for name in APP_LOGGERS:
        logger = logging.getLogger(name)
        if _FILTER not in logger.filters:
            logger.addFilter(_FILTER)
        for handler in logger.handlers:
            _attach(handler)
    for name in QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
