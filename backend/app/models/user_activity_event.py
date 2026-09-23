"""user_activity_event — per-user search and restaurant-tile-click history
for signed-in `registered_user` (diner) accounts ONLY.

Backs the admin "Registered users" report's per-user activity view and is
included in the caller's CCPA export / deletion (docs/DECISIONS.md
"Registered-user activity tracking (searches + tile clicks)", approved by
the user 2026-09-23). Anonymous visitors, owners, managers and admins are
never recorded here — enforced in `app/services/activity_service.py` and at
the two recording call sites (`GET /search`, `POST /activity/tile-click`).

Shape:
- `user_sub` is the Cognito `sub` as a bare string (same join key and
  same "no local registered_user table" reasoning as `user_follow.user_id`
  / `user_profile.cognito_sub`) — deliberately NOT a foreign key.
- `event_type` is `'search'` or `'tile_click'`, validated in the service
  layer, stored as plain text so a third event type never needs a migration.
- `payload` is a small, size-bounded JSON document (see
  `activity_service.build_search_payload` / `build_tile_click_payload`
  for exactly which keys and limits). Search: query text, cuisine/dietary/
  type filters, the location text the user typed, result count. Tile click:
  `brand_id`, `location_id` (nullable) and `source` surface. Brand/location
  ids inside the payload are NOT foreign keys — an event must survive (and
  never block) a later restaurant/location deletion; the admin view
  resolves names at read time and shows "removed restaurant" if gone.
- `created_at` is indexed and is what the 12-month retention rule keys off
  (`activity_service.ACTIVITY_RETENTION_DAYS`).

Not on root CLAUDE.md's audited-entity list and no audit_log entry is
written — same treatment as `user_profile.last_seen_at`; this is a
behavioural log, not a business record (and `audit_log.record_id` is a
BigInteger polymorphic over the audited tables' PKs).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserActivityEvent(Base):
    __tablename__ = "user_activity_event"
    __table_args__ = (
        # Per-user, newest-first paging (admin activity view + CCPA export).
        Index("ix_user_activity_event_user_created", "user_sub", "created_at"),
        # Retention purge scans by age alone.
        Index("ix_user_activity_event_created", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Cognito `sub` of the registered_user. See module docstring.
    user_sub: Mapped[str] = mapped_column(String(36), nullable=False)

    # 'search' | 'tile_click'
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)

    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<UserActivityEvent user_sub={self.user_sub!r} type={self.event_type}>"
