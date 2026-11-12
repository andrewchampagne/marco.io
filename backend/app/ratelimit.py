"""Per-minute rate limits on every API endpoint, plus the one-request-in-flight rule.

Both live in process memory, which is fine for a single server process. A multi-process deployment
would move them to Redis (a v2 item). Limits are keyed by the salted IP hash, so raw IPs never
persist, not even in memory.
"""

from __future__ import annotations

import json
import math
import threading
import time
from collections import deque
from collections.abc import Callable

from starlette.types import ASGIApp, Receive, Scope, Send

from .config import Settings
from .identity import Keys, client_ip_from_scope

HEAVY_ROUTES = {("POST", "/api/maps"), ("POST", "/api/key/validate")}


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_s: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self.limit, self.window, self.clock = limit, window_s, clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._calls = 0

    def hit(self, key: str) -> float | None:
        """Record a hit. Returns None if allowed, else seconds until the next slot frees."""
        now = self.clock()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return max(0.0, hits[0] + self.window - now)
            hits.append(now)
            self._calls += 1
            if self._calls % 1000 == 0:  # drop idle keys now and then
                self._hits = {k: v for k, v in self._hits.items() if v and v[-1] > now - self.window}
            return None


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings, keys: Keys):
        self.app, self.settings, self.keys = app, settings, keys
        self.general = SlidingWindowLimiter(settings.rate_limit_per_minute)
        self.heavy = SlidingWindowLimiter(settings.maps_rate_limit_per_minute)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if scope["type"] != "http" or not path.startswith("/api") or path == "/api/health":
            await self.app(scope, receive, send)
            return
        key = self.keys.ip_hash(client_ip_from_scope(scope, self.settings))
        retry = self.general.hit(key)
        if retry is None and (scope.get("method"), path) in HEAVY_ROUTES:
            retry = self.heavy.hit(key)
        if retry is not None:
            seconds = max(1, math.ceil(retry))
            body = json.dumps({"code": "rate_limited", "message": "Too many requests. Please slow down.",
                               "retry_after": seconds}).encode()
            await send({"type": "http.response.start", "status": 429, "headers": [
                (b"content-type", b"application/json"), (b"retry-after", str(seconds).encode()),
                (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)


class InFlight:
    """At most one map request in flight per client (visitor cookie and, if signed in, user)."""

    def __init__(self) -> None:
        self._active: set[str] = set()
        self._lock = threading.Lock()

    def acquire(self, keys: list[str]) -> bool:
        with self._lock:
            if any(k in self._active for k in keys):
                return False
            self._active.update(keys)
            return True

    def release(self, keys: list[str]) -> None:
        with self._lock:
            self._active.difference_update(keys)

    def busy(self, keys: list[str]) -> bool:
        with self._lock:
            return any(k in self._active for k in keys)


class CsrfMiddleware:
    """Mutating API calls must carry `X-Requested-With`. Cross-site forms can't set custom headers, and we
    send no CORS headers, so a forged request can't either. This is defense in depth on top of SameSite=Lax."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope.get("method") in ("POST", "PUT", "PATCH", "DELETE")
            and scope.get("path", "").startswith("/api")
            and not any(name == b"x-requested-with" for name, _ in scope.get("headers") or [])
        ):
            body = json.dumps({"code": "csrf", "message": "Missing X-Requested-With header."}).encode()
            await send({"type": "http.response.start", "status": 403, "headers": [
                (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)
