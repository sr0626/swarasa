"""location_daily_stat -- per-location, per-day engagement COUNTERS for the
owner "Insights" view (docs/PROJECT_PLAN.csv "Owner analytics dashboard").

PRIVACY BY CONSTRUCTION: this table holds only aggregate integers. There is
no IP address, user id, session id, cookie value, user agent or per-visit row
anywhere in it -- a visit is "+1 on today's counter" and nothing else is kept
about who made it. That is why it needs no CCPA export/deletion entry
(docs/DATA_MODEL.md): there is no personal data to export or delete. It is
deliberately NOT mixed with `user_activity_event` (per-signed-in-user search
and tile-click HISTORY): that table is personal data with 12-month retention,
this one is anonymous totals.

Shape:
- Composite primary key `(location_id, stat_date)` -- exactly one row per
  location per day, which is also what the atomic upsert
  (`analytics_service.record_event`: `INSERT ... ON CONFLICT DO UPDATE SET
  n = n + 1`) targets. No surrogate id, no audit_log entry (not on the
  audited-entity list; counters are not business records).
- `stat_date` is a UTC calendar date, NOT the location's local date: one
  consistent day boundary for every location and no timezone lookup on the
  hot write path. Insights days therefore roll over at UTC midnight.
- One integer column per event type (the closed set in
  `analytics_service.EVENT_COLUMNS`). Adding an event later is an additive
  migration.
- `location_id` is `ON DELETE CASCADE`: the counters leave with the location.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import BigInteger, Date, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LocationDailyStat(Base):
    __tablename__ = "location_daily_stat"

    location_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_location.id", ondelete="CASCADE"),
        primary_key=True,
        autoincrement=False,
    )
    stat_date: Mapped[date] = mapped_column(Date, primary_key=True, autoincrement=False)

    page_views: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    tile_clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    deal_views: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    website_clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    directions_clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    phone_clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<LocationDailyStat location_id={self.location_id} date={self.stat_date}>"
