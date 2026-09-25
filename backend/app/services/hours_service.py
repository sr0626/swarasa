"""restaurant_hours CRUD + the open/closed *display* status computation.

DECISIONS.md "Restaurant hours": display open/closed status is Phase 1
scope (a per-row lookup), the `open_now` *search filter* is Phase 3 — this
module only ever computes/returns display status, never filters `/search`.

day_of_week convention: 0=Monday..6=Sunday (docs/DATA_MODEL.md judgment
call, matching Python's `date.weekday()` / `datetime.weekday()`) —
confirmed and used as-is.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime as dt
from datetime import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.restaurant_hours import RestaurantHours
from app.schemas.hours import HourEntryIn

_DEFAULT_TZ = "America/Chicago"


def safe_zone(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(_DEFAULT_TZ)


async def get_hours_for_location(db: AsyncSession, location_id: int) -> list[RestaurantHours]:
    result = await db.execute(
        select(RestaurantHours)
        .where(RestaurantHours.location_id == location_id)
        .order_by(RestaurantHours.day_of_week)
    )
    return list(result.scalars().all())


async def get_hours_map_for_locations(
    db: AsyncSession, location_ids: list[int]
) -> dict[int, list[RestaurantHours]]:
    if not location_ids:
        return {}
    result = await db.execute(
        select(RestaurantHours)
        .where(RestaurantHours.location_id.in_(location_ids))
        .order_by(RestaurantHours.day_of_week)
    )
    by_location: dict[int, list[RestaurantHours]] = {lid: [] for lid in location_ids}
    for row in result.scalars().all():
        by_location.setdefault(row.location_id, []).append(row)
    return by_location


def _within(open_time: time, close_time: time, now_t: time) -> bool:
    if open_time <= close_time:
        return open_time <= now_t <= close_time
    # Overnight hours crossing midnight (e.g. open 18:00, close 02:00).
    return now_t >= open_time or now_t <= close_time


def compute_is_open_now(
    today_hours: RestaurantHours | None, tz_name: str, now: dt | None = None
) -> bool | None:
    """`None` = hours unknown for today ("call ahead") — never guessed.

    `now` is for tests only (an aware or naive datetime already expressed in
    the location's timezone); production callers omit it.
    """
    if today_hours is None or today_hours.is_closed is None:
        return None
    if today_hours.is_closed:
        return False
    if today_hours.open_time is None or today_hours.close_time is None:
        return None
    now_t = (now if now is not None else dt.now(safe_zone(tz_name))).time()
    return _within(today_hours.open_time, today_hours.close_time, now_t)


def today_weekday(tz_name: str) -> int:
    return dt.now(safe_zone(tz_name)).weekday()


async def is_open_now_for_location(db: AsyncSession, location_id: int, tz_name: str) -> bool | None:
    """Single-location convenience lookup — used by /search, which doesn't
    otherwise need the full 7-row hours list.
    """
    day = today_weekday(tz_name)
    result = await db.execute(
        select(RestaurantHours).where(
            RestaurantHours.location_id == location_id,
            RestaurantHours.day_of_week == day,
        )
    )
    return compute_is_open_now(result.scalar_one_or_none(), tz_name)


@dataclass(frozen=True)
class TodayStatus:
    """Today's hours in the location's own timezone, for the search card's
    "Open today 11am-9pm" / "Closed today" label. All-None = unknown.
    """

    is_open_now: bool | None
    open_time: time | None
    close_time: time | None
    is_closed: bool | None
    # Only meaningful when `is_open_now` is False on an open day with known
    # times: True = "now" is BEFORE today's opening time ("Closed now · opens
    # 10am"), False = already past closing ("Closed now"). None otherwise
    # (open now, closed all day, hours unknown). Computed server-side in the
    # location's timezone so the browser never needs a clock.
    opens_later_today: bool | None = None


def compute_today_status(
    today_hours: RestaurantHours | None, tz_name: str, now: dt | None = None
) -> TodayStatus:
    now = now if now is not None else dt.now(safe_zone(tz_name))
    is_open_now = compute_is_open_now(today_hours, tz_name, now)
    if today_hours is None or today_hours.is_closed is None:
        return TodayStatus(is_open_now, None, None, None)
    if today_hours.is_closed:
        return TodayStatus(is_open_now, None, None, True)
    # Open day: only expose the times when both are present (never guess).
    if today_hours.open_time is None or today_hours.close_time is None:
        return TodayStatus(is_open_now, None, None, False)
    opens_later = None if is_open_now else now.time() < today_hours.open_time
    return TodayStatus(
        is_open_now, today_hours.open_time, today_hours.close_time, False, opens_later
    )


async def today_status_for_location(
    db: AsyncSession, location_id: int, tz_name: str
) -> TodayStatus:
    """Like `is_open_now_for_location`, but also returns today's hours —
    used by /search, whose cards show today's open/close times.
    """
    day = today_weekday(tz_name)
    result = await db.execute(
        select(RestaurantHours).where(
            RestaurantHours.location_id == location_id,
            RestaurantHours.day_of_week == day,
        )
    )
    return compute_today_status(result.scalar_one_or_none(), tz_name)


async def replace_hours(db: AsyncSession, location_id: int, entries: list[HourEntryIn]) -> None:
    """Upsert by (location_id, day_of_week) — matches the table's unique
    constraint. A day omitted from `entries` is left untouched (existing
    row kept as-is, or simply absent == "hours unknown" per
    docs/API_CONTRACTS.md "PUT /locations/{id}/hours").
    """
    existing = await get_hours_for_location(db, location_id)
    existing_by_day = {row.day_of_week: row for row in existing}
    for entry in entries:
        row = existing_by_day.get(entry.day_of_week)
        if row is not None:
            row.open_time = entry.open_time
            row.close_time = entry.close_time
            row.is_closed = entry.is_closed
        else:
            db.add(
                RestaurantHours(
                    location_id=location_id,
                    day_of_week=entry.day_of_week,
                    open_time=entry.open_time,
                    close_time=entry.close_time,
                    is_closed=entry.is_closed,
                )
            )
