"""ORM models. Only what the product needs is stored; never API keys, never raw IP addresses."""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, utcnow


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    google_sub: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(320))
    name: Mapped[str | None] = mapped_column(String(200))
    avatar_url: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Map(Base):
    """A generated map: the cache entry for its normalized question, and the target of share links."""

    __tablename__ = "maps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    raw_query: Mapped[str] = mapped_column(String(400))
    normalized_query: Mapped[str] = mapped_column(String(400))
    query_hash: Mapped[str] = mapped_column(String(64), index=True)
    contract_version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16))  # ok | unmappable
    meta: Mapped[dict[str, Any]] = mapped_column(JSON)
    rows: Mapped[list[Any]] = mapped_column(JSON)  # cleaned data rows only: [iso3, value, conf, note]
    source: Mapped[str] = mapped_column(String(16))  # llm | llm+web | worldbank
    source_info: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    strategy: Mapped[str] = mapped_column(String(8))  # A | B | C
    mock: Mapped[bool] = mapped_column(Boolean, default=False)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    web_searches: Mapped[int] = mapped_column(Integer, default=0)
    cost_est: Mapped[float] = mapped_column(Float, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    client_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    hits: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class UsageEvent(Base):
    """One map request. `counted` events are the ones the free-tier quota counts."""

    __tablename__ = "usage_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_hash: Mapped[str] = mapped_column(String(64), index=True)
    ip_hash: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    status: Mapped[str] = mapped_column(String(16))  # ok | unmappable | error | empty
    source: Mapped[str] = mapped_column(String(16))  # llm | llm+web | worldbank | cache
    cache_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    byok: Mapped[bool] = mapped_column(Boolean, default=False)
    counted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_est: Mapped[float] = mapped_column(Float, default=0.0)
    error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    map_id: Mapped[int | None] = mapped_column(ForeignKey("maps.id", ondelete="SET NULL"), nullable=True)


class HistoryEntry(Base):
    """What a visitor or user asked (as typed), pointing at the map that answered it."""

    __tablename__ = "history_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    map_id: Mapped[int] = mapped_column(ForeignKey("maps.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    client_hash: Mapped[str] = mapped_column(String(64), index=True)
    query: Mapped[str] = mapped_column(String(400))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
