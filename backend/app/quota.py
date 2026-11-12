"""Free-tier quota (rolling 24 h) and the daily budget circuit breaker.

Quota: three dimensions are counted separately (visitor cookie, IP hash, signed-in user), and a request
is blocked if ANY of them is at its limit. That's what makes clearing cookies or signing in useless as a
reset. Only `counted` events count: free-tier LLM calls that ended ok or unmappable.

Budget: free-tier spend (sum of cost_est) for the current UTC day. At or above DAILY_BUDGET_USD the free
tier pauses until midnight UTC, and BYOK keeps working.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import Settings
from .db import as_utc, utcnow
from .models import UsageEvent

WINDOW = dt.timedelta(hours=24)


@dataclass
class QuotaStatus:
    used: int
    limit: int
    remaining: int
    reset_at: dt.datetime | None

    @property
    def exhausted(self) -> bool:
        return self.remaining <= 0


def _times(db: Session, condition, start: dt.datetime) -> list[dt.datetime]:
    rows = db.scalars(
        select(UsageEvent.created_at)
        .where(UsageEvent.counted.is_(True), UsageEvent.created_at > start, condition)
        .order_by(UsageEvent.created_at)
    )
    return [as_utc(t) for t in rows]


def quota_status(
    db: Session,
    settings: Settings,
    *,
    client_hash: str,
    ip_hash: str,
    user_id: int | None,
    now: dt.datetime | None = None,
) -> QuotaStatus:
    now = now or utcnow()
    start = now - WINDOW
    limit = settings.free_maps_per_day
    dims = [
        (_times(db, UsageEvent.client_hash == client_hash, start), limit),
        (_times(db, UsageEvent.ip_hash == ip_hash, start), settings.free_maps_per_ip_per_day),
    ]
    if user_id is not None:
        dims.append((_times(db, UsageEvent.user_id == user_id, start), limit))
    left = [lim - len(ts) for ts, lim in dims]
    remaining = max(0, min(limit, min(left)))
    reset_at: dt.datetime | None = None
    if remaining <= 0:
        # Blocked until every saturated dimension frees one slot.
        frees = [ts[len(ts) - lim] + WINDOW for (ts, lim), r in zip(dims, left) if r <= 0 and 0 < lim <= len(ts)]
        reset_at = max(frees) if frees else None
    else:
        tightest = min(left)
        oldest = [ts[0] for (ts, _), r in zip(dims, left) if ts and r == tightest]
        reset_at = min(oldest) + WINDOW if oldest else None
    return QuotaStatus(used=limit - remaining, limit=limit, remaining=remaining, reset_at=reset_at)


def start_of_utc_day(now: dt.datetime) -> dt.datetime:
    return now.astimezone(dt.UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def free_spend_today(db: Session, now: dt.datetime | None = None) -> float:
    now = now or utcnow()
    total = db.scalar(
        select(func.coalesce(func.sum(UsageEvent.cost_est), 0.0))
        .where(UsageEvent.byok.is_(False), UsageEvent.created_at >= start_of_utc_day(now))
    )
    return float(total or 0.0)


def budget_exhausted(db: Session, settings: Settings, now: dt.datetime | None = None) -> bool:
    return free_spend_today(db, now) >= settings.daily_budget_usd


def budget_resets_at(now: dt.datetime | None = None) -> dt.datetime:
    return start_of_utc_day(now or utcnow()) + dt.timedelta(days=1)
