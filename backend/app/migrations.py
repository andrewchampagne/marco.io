"""Simple versioned migrations, applied in order at startup and recorded in `schema_migrations`.

How to add one: append `(N, "what it does", fn)` to MIGRATIONS, where `fn(conn)` makes the change.
Keep migrations idempotent (use the helpers below), because migration 1 creates tables from the *current*
models, so on a fresh database a later "add column" may find the column already there.
"""

from __future__ import annotations

import datetime as dt
import logging
from collections.abc import Callable

from sqlalchemy import Connection, Engine, inspect, text

from . import models  # noqa: F401  (registers the tables on Base.metadata)
from .db import Base

log = logging.getLogger(__name__)


def add_column_if_missing(conn: Connection, table: str, column: str, ddl: str) -> None:
    """Example helper for future migrations: add_column_if_missing(conn, "maps", "hits", "INTEGER DEFAULT 0")."""
    existing = {c["name"] for c in inspect(conn).get_columns(table)}
    if column not in existing:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def _initial(conn: Connection) -> None:
    Base.metadata.create_all(conn, checkfirst=True)


def _map_region(conn: Connection) -> None:
    add_column_if_missing(conn, "maps", "region", "VARCHAR(32) NOT NULL DEFAULT 'world'")


MIGRATIONS: list[tuple[int, str, Callable[[Connection], None]]] = [
    (1, "initial schema: users, maps, usage_events, history_entries", _initial),
    (2, "maps.region: the focus region a map was made for", _map_region),
]


def migrate(engine: Engine) -> list[int]:
    applied_now: list[int] = []
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version INTEGER PRIMARY KEY, name VARCHAR(200) NOT NULL, applied_at VARCHAR(40) NOT NULL)"
        ))
        done = {row[0] for row in conn.execute(text("SELECT version FROM schema_migrations"))}
        for version, name, fn in MIGRATIONS:
            if version in done:
                continue
            fn(conn)
            conn.execute(
                text("INSERT INTO schema_migrations (version, name, applied_at) VALUES (:v, :n, :t)"),
                {"v": version, "n": name, "t": dt.datetime.now(dt.UTC).isoformat()},
            )
            applied_now.append(version)
            log.info("Applied migration %s: %s", version, name)
    return applied_now
