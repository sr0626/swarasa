"""Owner analytics -- anonymous per-location, per-day COUNTERS.

See docs/API_CONTRACTS.md "Owner analytics" and docs/DATA_MODEL.md
`location_daily_stat`. Rules this module enforces:

- NO PERSONAL DATA. A recorded event is `+1` on one integer column of one
  `(location_id, stat_date)` row. Nothing about the caller is stored: no IP,
  user id, session id, cookie or per-visit row. (The caller's identity is
  consulted only to DROP the event when the caller is the location's own
  owner / assigned manager / an admin, and is then discarded.)
- UTC DAYS. `stat_date` is the UTC calendar date of the event.
- BEST-EFFORT. `record_event` never raises: an unknown event, a hidden or
  unknown location, a self-view, or a failed write are all silently
  dropped -- the route answers 204 regardless, so tracking can never fail or
  delay a visitor's page, and the endpoint is not an existence oracle for
  hidden locations.
- ATOMIC. One `INSERT ... ON CONFLICT (location_id, stat_date) DO UPDATE SET
  col = col + 1` -- no read-modify-write race between concurrent Lambdas.
  Dialect-specific construct (PostgreSQL in production, SQLite in the test
  DB); both expose the same `on_conflict_do_update` API.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.deal import Deal
from app.models.location_daily_stat import LocationDailyStat
from app.models.location_manager import LocationManager
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.analytics import (
    BrandAnalyticsOut,
    BrandLocationTotals,
    DailyPoint,
    LocationAnalyticsOut,
    MetricChange,
    MetricTotals,
)
from app.services import auth_service, follow_service

logger = logging.getLogger("app.services.analytics")

# Client event name -> counter column. The closed set of recordable events.
EVENT_COLUMNS: dict[str, str] = {
    "page_view": "page_views",
    "tile_click": "tile_clicks",
    "deal_view": "deal_views",
    "website_click": "website_clicks",
    "directions_click": "directions_clicks",
    "phone_click": "phone_clicks",
}
METRICS: tuple[str, ...] = tuple(EVENT_COLUMNS.values())

ALLOWED_RANGES: tuple[int, ...] = (7, 30, 90)

# Roles whose own-location views are not counted.
_STAFF_ROLES = ("owner", "manager", "admin")


# --- Pure helpers (unit-tested without a DB) ------------------------------


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


def period_bounds(today: date, days: int) -> tuple[date, date, date, date]:
    """`(start, end, prev_start, prev_end)`, all inclusive UTC dates.

    The current window is the `days` days ending TODAY (a partial day); the
    previous window is the `days` days immediately before it. Equal length,
    adjacent, no overlap.
    """
    start = today - timedelta(days=days - 1)
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=days - 1)
    return start, today, prev_start, prev_end


def percent_change(current: int, previous: int) -> float | None:
    """Percentage change, 1 decimal. `None` when `previous` is 0 (undefined
    -- the UI says "new" / "no data" rather than showing infinity)."""
    if previous <= 0:
        return None
    return round((current - previous) * 100.0 / previous, 1)


def fill_series(rows: dict[date, dict[str, int]], start: date, days: int) -> list[DailyPoint]:
    """One `DailyPoint` per day in `[start, start + days)`, zeros for days
    with no row, oldest first."""
    points: list[DailyPoint] = []
    for offset in range(days):
        d = start + timedelta(days=offset)
        counts = rows.get(d, {})
        points.append(DailyPoint(date=d, **{m: int(counts.get(m, 0)) for m in METRICS}))
    return points


def sum_totals(points: list[DailyPoint]) -> MetricTotals:
    return MetricTotals(**{m: sum(getattr(p, m) for p in points) for m in METRICS})


def compute_change(current: MetricTotals, previous: MetricTotals) -> MetricChange:
    return MetricChange(
        **{m: percent_change(getattr(current, m), getattr(previous, m)) for m in METRICS}
    )


# --- Recording -------------------------------------------------------------


def _upsert_increment(db: AsyncSession, location_id: int, stat_date: date, column: str):
    dialect = db.get_bind().dialect.name
    insert_fn = pg_insert if dialect == "postgresql" else sqlite_insert
    table = LocationDailyStat.__table__
    values = {"location_id": location_id, "stat_date": stat_date, **{m: 0 for m in METRICS}}
    values[column] = 1
    stmt = insert_fn(table).values(**values)
    return stmt.on_conflict_do_update(
        index_elements=["location_id", "stat_date"],
        set_={column: table.c[column] + 1},
    )


async def _caller_is_location_staff(
    db: AsyncSession, location: RestaurantLocation, brand: RestaurantBrand, current_user
) -> bool:
    """True when `current_user` is an admin, the owner of this location's
    brand, or an actively assigned manager of this location. Always derived
    from the database (never JWT claims alone)."""
    if current_user is None or current_user.role not in _STAFF_ROLES:
        return False
    if current_user.role == "admin":
        return True
    if current_user.role == "owner":
        owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
        return owner is not None and brand.owner_id == owner.id
    result = await db.execute(
        select(LocationManager.id).where(
            LocationManager.user_id == current_user.cognito_sub,
            LocationManager.location_id == location.id,
            LocationManager.is_active == True,  # noqa: E712
        )
    )
    return result.first() is not None


async def record_event(db: AsyncSession, location_id: int, event: str, current_user=None) -> bool:
    """Count one event. Returns True when a counter was incremented. NEVER
    raises -- see module docstring."""
    column = EVENT_COLUMNS.get(event)
    if column is None:
        return False
    try:
        row = (
            await db.execute(
                select(RestaurantLocation, RestaurantBrand)
                .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
                .where(
                    RestaurantLocation.id == location_id,
                    RestaurantLocation.status == RestaurantLocation.STATUS_ACTIVE,
                    RestaurantBrand.deleted_at.is_(None),
                )
            )
        ).first()
        if row is None:
            return False
        location, brand = row
        if await _caller_is_location_staff(db, location, brand, current_user):
            return False
        await db.execute(_upsert_increment(db, location_id, today_utc(), column))
        await db.commit()
        return True
    except Exception:  # noqa: BLE001 - best-effort by design
        logger.warning("analytics: could not record event", exc_info=True)
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return False


# --- Reading ---------------------------------------------------------------


def _check_range(days: int) -> None:
    if days not in ALLOWED_RANGES:
        raise AppError(422, "days must be 7, 30 or 90", "validation_error")


def _sum_columns():
    return [func.sum(getattr(LocationDailyStat, m)).label(m) for m in METRICS]


async def _daily_rows(
    db: AsyncSession, location_ids: list[int], start: date, end: date
) -> dict[date, dict[str, int]]:
    """Per-day counters summed over `location_ids` for `[start, end]`."""
    if not location_ids:
        return {}
    result = await db.execute(
        select(LocationDailyStat.stat_date, *_sum_columns())
        .where(
            LocationDailyStat.location_id.in_(location_ids),
            LocationDailyStat.stat_date >= start,
            LocationDailyStat.stat_date <= end,
        )
        .group_by(LocationDailyStat.stat_date)
    )
    return {r[0]: {m: int(r[i + 1] or 0) for i, m in enumerate(METRICS)} for r in result.all()}


async def _data_since(db: AsyncSession, location_ids: list[int]) -> date | None:
    if not location_ids:
        return None
    return (
        await db.execute(
            select(func.min(LocationDailyStat.stat_date)).where(
                LocationDailyStat.location_id.in_(location_ids)
            )
        )
    ).scalar_one_or_none()


async def _active_deal_count(db: AsyncSession, location_ids: list[int]) -> int:
    if not location_ids:
        return 0
    now = datetime.now(timezone.utc)
    return (
        await db.execute(
            select(func.count())
            .select_from(Deal)
            .where(
                Deal.location_id.in_(location_ids),
                Deal.is_active == True,  # noqa: E712
                or_(Deal.end_at.is_(None), Deal.end_at > now),
            )
        )
    ).scalar_one()


async def _build(db: AsyncSession, location_ids: list[int], brand_id: int, days: int) -> dict:
    start, end, prev_start, _prev_end = period_bounds(today_utc(), days)
    rows = await _daily_rows(db, location_ids, prev_start, end)
    series = fill_series(rows, start, days)
    previous = fill_series(rows, prev_start, days)
    totals = sum_totals(series)
    previous_totals = sum_totals(previous)
    return dict(
        days=days,
        start_date=start,
        end_date=end,
        series=series,
        totals=totals,
        previous_totals=previous_totals,
        change_pct=compute_change(totals, previous_totals),
        data_since=await _data_since(db, location_ids),
        # Follows are brand-level, so a location reports its brand's count.
        follower_count=await follow_service.count_followers_for_brand(db, brand_id),
        active_deal_count=await _active_deal_count(db, location_ids),
    )


async def get_location_analytics(
    db: AsyncSession, location_id: int, days: int
) -> LocationAnalyticsOut:
    """Caller authorization (owner / assigned manager / admin) has already
    been enforced by the router's `require_location_read_access`."""
    _check_range(days)
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")
    data = await _build(db, [location.id], location.brand_id, days)
    return LocationAnalyticsOut(location_id=location.id, **data)


async def get_brand_analytics(db: AsyncSession, brand_id: int, days: int) -> BrandAnalyticsOut:
    """Owner-of-brand / admin only (router: `require_brand_write_access`)."""
    _check_range(days)
    brand = await db.get(RestaurantBrand, brand_id)
    if brand is None or brand.deleted_at is not None:
        raise AppError(404, "Restaurant not found", "not_found")
    locations = (
        await db.execute(
            select(RestaurantLocation.id, RestaurantLocation.address_line1, RestaurantLocation.city)
            .where(RestaurantLocation.brand_id == brand_id)
            .order_by(RestaurantLocation.id)
        )
    ).all()
    location_ids = [r[0] for r in locations]
    data = await _build(db, location_ids, brand_id, days)

    per_location = await db.execute(
        select(LocationDailyStat.location_id, *_sum_columns())
        .where(
            LocationDailyStat.location_id.in_(location_ids or [0]),
            LocationDailyStat.stat_date >= data["start_date"],
            LocationDailyStat.stat_date <= data["end_date"],
        )
        .group_by(LocationDailyStat.location_id)
    )
    sums = {
        r[0]: MetricTotals(**{m: int(r[i + 1] or 0) for i, m in enumerate(METRICS)})
        for r in per_location.all()
    }
    by_location = [
        BrandLocationTotals(
            location_id=lid, label=f"{address}, {city}", totals=sums.get(lid, MetricTotals())
        )
        for lid, address, city in locations
    ]
    return BrandAnalyticsOut(
        brand_id=brand_id, location_count=len(location_ids), by_location=by_location, **data
    )
