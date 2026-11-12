import datetime as dt

import pytest

from app.db import make_engine, make_session_factory
from app.migrations import migrate
from app.models import UsageEvent, User
from app.quota import budget_exhausted, free_spend_today, quota_status

from .conftest import make_settings

NOW = dt.datetime(2026, 11, 11, 12, 0, tzinfo=dt.UTC)


@pytest.fixture
def db(tmp_path):
    engine = make_engine(f"sqlite:///{(tmp_path / 'q.db').as_posix()}")
    migrate(engine)
    with make_session_factory(engine)() as session:
        yield session
    engine.dispose()


def add(db, hours_ago, *, client="c1", ip="ip1", user=None, counted=True, byok=False, cost=0.0):
    db.add(UsageEvent(client_hash=client, ip_hash=ip, user_id=user, status="ok", source="llm",
                      counted=counted, byok=byok, cost_est=cost, created_at=NOW - dt.timedelta(hours=hours_ago)))
    db.commit()


def status(db, settings, **kw):
    args = dict(client_hash="c1", ip_hash="ip1", user_id=None)
    args.update(kw)
    return quota_status(db, settings, now=NOW, **args)


def test_rolling_window_counts_only_last_24h(db, tmp_path):
    settings = make_settings(tmp_path)
    add(db, 30)  # outside the window
    add(db, 20)
    add(db, 2)
    s = status(db, settings)
    assert (s.used, s.remaining) == (2, 1)
    assert s.reset_at == NOW - dt.timedelta(hours=20) + dt.timedelta(hours=24)


def test_blocked_until_oldest_counted_event_expires(db, tmp_path):
    settings = make_settings(tmp_path)
    for hours in (23, 10, 1):
        add(db, hours)
    s = status(db, settings)
    assert s.exhausted and s.remaining == 0
    assert s.reset_at == NOW + dt.timedelta(hours=1)  # the 23h-old event frees a slot in one hour
    later = quota_status(db, settings, client_hash="c1", ip_hash="ip1", user_id=None,
                         now=NOW + dt.timedelta(hours=1, seconds=1))
    assert later.remaining == 1


def test_uncounted_events_are_ignored(db, tmp_path):
    settings = make_settings(tmp_path)
    for _ in range(5):
        add(db, 1, counted=False)
    assert status(db, settings).remaining == 3


def test_any_dimension_at_limit_blocks(db, tmp_path):
    settings = make_settings(tmp_path)
    # three different cookies, same IP: a cookie-clearing user
    for client in ("a", "b", "c"):
        add(db, 1, client=client)
    fresh_cookie = status(db, settings, client_hash="new-cookie")
    assert fresh_cookie.exhausted
    other_ip = status(db, settings, client_hash="new-cookie", ip_hash="ip2")
    assert other_ip.remaining == 3


def test_user_dimension_follows_account_across_ips(db, tmp_path):
    settings = make_settings(tmp_path)
    user = User(google_sub="sub-7", email="u@example.com", name="U")
    db.add(user)
    db.commit()
    for ip in ("x", "y", "z"):
        add(db, 1, client=f"c-{ip}", ip=ip, user=user.id)
    s = status(db, settings, client_hash="another-browser", ip_hash="another-ip", user_id=user.id)
    assert s.exhausted


def test_ip_bucketing():
    from app.identity import ip_bucket

    assert ip_bucket("203.0.113.7") == "203.0.113.7"
    assert ip_bucket("2001:db8:1:2:3:4:5:6") == ip_bucket("2001:db8:1:2:ffff::1") == "2001:db8:1:2::"
    assert ip_bucket("::ffff:198.51.100.4") == "198.51.100.4"
    assert ip_bucket("testclient") == "testclient"


def test_per_ip_limit_is_separately_configurable(db, tmp_path):
    settings = make_settings(tmp_path, free_maps_per_ip_per_day=10)
    for client in ("a", "b", "c", "d"):
        add(db, 1, client=client)
    assert status(db, settings, client_hash="e").remaining == 3


def test_budget_counts_free_tier_spend_for_current_utc_day(db, tmp_path):
    settings = make_settings(tmp_path, daily_budget_usd=0.01)
    add(db, 1, cost=0.004)
    add(db, 2, cost=0.004, counted=False)  # errors still cost money
    add(db, 3, cost=5.0, byok=True)  # BYOK spend is the user's, not ours
    add(db, 13, cost=1.0)  # yesterday (UTC)
    assert free_spend_today(db, NOW) == pytest.approx(0.008)
    assert not budget_exhausted(db, settings, NOW)
    add(db, 1, cost=0.003)
    assert budget_exhausted(db, settings, NOW)
