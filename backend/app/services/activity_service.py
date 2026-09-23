"""Registered-user activity tracking — searches and restaurant-tile clicks.

See docs/DECISIONS.md "Registered-user activity tracking (searches + tile
clicks)" (user-approved 2026-09-23) and docs/API_CONTRACTS.md "Activity
tracking (`/activity`)". Summary of the rules this module enforces:

- WHO: `registered_user` callers only. `record_*` helpers re-check the role
  themselves rather than trusting the call site, so anonymous/owner/manager/
  admin traffic can never produce a row even if a route is later wired up
  wrong.
- NEVER FAILS THE REQUEST: every write is wrapped in a broad
  try/except + rollback, mirroring
  `app/dependencies/auth.py::_touch_last_seen_best_effort` (PR #184). A
  problem recording a diner's search history must not turn into a 500 (or
  a slow error path) on the search itself.
- BOUNDED: every string/list stored is clipped (`MAX_*` constants below) so
  a client cannot stuff arbitrary amounts of data into the log through the
  query/filters/location fields.
- RETENTION: `ACTIVITY_RETENTION_DAYS` (12 months) is the single source of
  truth. Enforced two ways, deliberately with NO new AWS resource:
    1. READ SIDE (authoritative): every read (admin activity list, CCPA
       export) filters `created_at >= now - retention`, so an expired row
       is never shown or exported even if it has not been physically
       purged yet.
    2. WRITE SIDE (physical purge): `maybe_purge_expired` runs opportunistically
       after a successful write, at most once per `_PURGE_INTERVAL` per Lambda
       container, deleting expired rows table-wide in small batches. It is
       global (not per-user) so a user who stopped visiting still gets aged
       out as long as ANY registered user is active. The existing
       `deal_expiry` cron handler was considered and rejected: it is a
       documented-not-yet-deployable placeholder package (see that file's
       header — no bundled dependencies), and coupling an unrelated privacy
       purge to a deals job would make retention silently depend on it.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.models.user_activity_event import UserActivityEvent
from app.schemas.activity import (
    ActivityEventOut,
    TileClickIn,
    UserActivityResponse,
)

logger = logging.getLogger("app.services.activity")

# --- Retention (single source of truth — see module docstring) -----------
# 12 months, per the user's approved decision. Change ONLY here.
ACTIVITY_RETENTION_DAYS = 365

# --- Payload bounds --------------------------------------------------------
MAX_QUERY_LEN = 100  # matches GET /search `q` max_length
MAX_LOCATION_TEXT_LEN = 100
MAX_TAGS = 10  # per filter facet (cuisine / dietary / type)
MAX_TAG_LEN = 50

# --- Opportunistic purge tuning -------------------------------------------
_PURGE_INTERVAL_SECONDS = 3600.0
_PURGE_BATCH_SIZE = 500
_PURGE_MAX_BATCHES = 5
# Module-level, per-process (per Lambda container) throttle state. `None`
# = never purged in this process. Tests reset it directly.
_last_purge_monotonic: float | None = None

EVENT_SEARCH = "search"
EVENT_TILE_CLICK = "tile_click"

_WHITESPACE = re.compile(r"\s+")
# C0/C1 control characters (keeps tab/newline out; whitespace is collapsed
# separately above).
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def retention_cutoff(now: datetime | None = None) -> datetime:
    return (now or datetime.now(timezone.utc)) - timedelta(days=ACTIVITY_RETENTION_DAYS)


def _clip(value: str | None, max_len: int) -> str | None:
    """Strip control chars, collapse whitespace, truncate. `None`/blank -> None."""
    if value is None:
        return None
    cleaned = _WHITESPACE.sub(" ", _CONTROL_CHARS.sub(" ", value)).strip()
    if not cleaned:
        return None
    return cleaned[:max_len]


def _clip_list(values: list[str] | None) -> list[str]:
    out: list[str] = []
    for value in values or []:
        clipped = _clip(value, MAX_TAG_LEN)
        if clipped is not None:
            out.append(clipped)
        if len(out) >= MAX_TAGS:
            break
    return out


def build_search_payload(
    *,
    q: str | None,
    cuisine: list[str] | None,
    dietary: list[str] | None,
    type_: list[str] | None,
    loc: str | None,
    has_deals_today: bool | None,
    result_count: int | None,
) -> dict[str, Any] | None:
    """Bounded search payload, or `None` when the search carried no
    criteria at all (a bare "browse everything nearby" load is noise, not a
    search the admin view needs — see DECISIONS.md). Empty keys omitted.
    """
    payload: dict[str, Any] = {}
    if (clipped_q := _clip(q, MAX_QUERY_LEN)) is not None:
        payload["q"] = clipped_q
    for key, values in (("cuisine", cuisine), ("dietary", dietary), ("type", type_)):
        clipped_values = _clip_list(values)
        if clipped_values:
            payload[key] = clipped_values
    if (clipped_loc := _clip(loc, MAX_LOCATION_TEXT_LEN)) is not None:
        payload["loc"] = clipped_loc
    if has_deals_today:
        payload["has_deals_today"] = True

    if not payload:
        return None
    if result_count is not None:
        payload["result_count"] = max(0, int(result_count))
    return payload


def build_tile_click_payload(body: TileClickIn) -> dict[str, Any]:
    return {
        "brand_id": body.brand_id,
        "location_id": body.location_id,
        "source": body.source,
    }


async def _insert_event(
    db: AsyncSession, user_sub: str, event_type: str, payload: dict[str, Any]
) -> None:
    db.add(UserActivityEvent(user_sub=user_sub, event_type=event_type, payload=payload))
    await db.commit()


async def _record_best_effort(
    db: AsyncSession, user_sub: str, event_type: str, payload: dict[str, Any]
) -> None:
    """Insert one event; NEVER raises (see module docstring). Also fires the
    throttled retention purge after a successful write."""
    try:
        await _insert_event(db, user_sub, event_type, payload)
    except Exception:  # noqa: BLE001 - deliberately broad, see module docstring
        logger.warning("activity record failed for %s", user_sub, exc_info=True)
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001 - never let cleanup itself raise
            pass
        return
    await maybe_purge_expired(db)


async def record_search_best_effort(
    db: AsyncSession,
    current_user,
    *,
    q: str | None,
    cuisine: list[str] | None,
    dietary: list[str] | None,
    type_: list[str] | None,
    loc: str | None,
    has_deals_today: bool | None,
    result_count: int | None,
) -> None:
    """Record a search for a signed-in `registered_user`. No-op for every
    other caller (anonymous is `None`)."""
    try:
        if current_user is None or current_user.role != "registered_user":
            return
        payload = build_search_payload(
            q=q,
            cuisine=cuisine,
            dietary=dietary,
            type_=type_,
            loc=loc,
            has_deals_today=has_deals_today,
            result_count=result_count,
        )
        if payload is None:
            return
        await _record_best_effort(db, current_user.cognito_sub, EVENT_SEARCH, payload)
    except Exception:  # noqa: BLE001 - payload building etc. must not fail the request either
        logger.warning("activity search record failed", exc_info=True)


async def record_tile_click(db: AsyncSession, current_user, body: TileClickIn) -> None:
    """`POST /activity/tile-click`. Validates the ids (404 on a bad one — a
    client bug, not a recording failure), then records best-effort."""
    if current_user.role != "registered_user":
        # Belt-and-braces: the router's `require_registered_user` already
        # gates this; kept so the "registered users only" rule lives in the
        # service too.
        raise AppError(403, "Registered user access required", "forbidden")

    brand_exists = (
        await db.execute(select(RestaurantBrand.id).where(RestaurantBrand.id == body.brand_id))
    ).scalar_one_or_none()
    if brand_exists is None:
        raise AppError(404, "Restaurant not found", "not_found")

    if body.location_id is not None:
        location_brand = (
            await db.execute(
                select(RestaurantLocation.brand_id).where(
                    RestaurantLocation.id == body.location_id
                )
            )
        ).scalar_one_or_none()
        if location_brand is None or location_brand != body.brand_id:
            raise AppError(404, "Location not found", "not_found")

    await _record_best_effort(
        db, current_user.cognito_sub, EVENT_TILE_CLICK, build_tile_click_payload(body)
    )


async def purge_expired(db: AsyncSession, now: datetime | None = None) -> int:
    """Physically delete events older than the retention window, table-wide,
    in bounded batches. Returns rows deleted. Commits itself."""
    cutoff = retention_cutoff(now)
    deleted_total = 0
    for _ in range(_PURGE_MAX_BATCHES):
        expired_ids = (
            select(UserActivityEvent.id)
            .where(UserActivityEvent.created_at < cutoff)
            .limit(_PURGE_BATCH_SIZE)
        )
        result = await db.execute(
            delete(UserActivityEvent).where(UserActivityEvent.id.in_(expired_ids))
        )
        await db.commit()
        batch = result.rowcount or 0
        deleted_total += batch
        if batch < _PURGE_BATCH_SIZE:
            break
    return deleted_total


async def maybe_purge_expired(db: AsyncSession) -> None:
    """Throttled, best-effort `purge_expired` (see module docstring for why
    it runs on write rather than on a schedule). Never raises."""
    global _last_purge_monotonic
    now_mono = time.monotonic()
    if (
        _last_purge_monotonic is not None
        and now_mono - _last_purge_monotonic < _PURGE_INTERVAL_SECONDS
    ):
        return
    # Claim the slot first so a slow/failed purge isn't retried on every
    # subsequent request.
    _last_purge_monotonic = now_mono
    try:
        await purge_expired(db)
    except Exception:  # noqa: BLE001 - retention housekeeping must never fail a request
        logger.warning("activity retention purge failed", exc_info=True)
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001
            pass


async def list_user_activity(
    db: AsyncSession,
    user_sub: str,
    pagination: Pagination,
    event_type: str | None = None,
) -> UserActivityResponse:
    """Admin per-user activity list, newest first, within the retention
    window only. Brand/location names are resolved with two batched queries
    for the page (no N+1)."""
    cutoff = retention_cutoff()
    conditions = [
        UserActivityEvent.user_sub == user_sub,
        UserActivityEvent.created_at >= cutoff,
    ]
    if event_type is not None:
        conditions.append(UserActivityEvent.event_type == event_type)

    total = (
        await db.execute(select(func.count()).select_from(UserActivityEvent).where(*conditions))
    ).scalar_one()

    rows = (
        await db.execute(
            select(UserActivityEvent)
            .where(*conditions)
            .order_by(UserActivityEvent.created_at.desc(), UserActivityEvent.id.desc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).scalars().all()

    brand_names, location_labels = await _resolve_names(db, rows)

    results = []
    for row in rows:
        brand_name = None
        location_label = None
        if row.event_type == EVENT_TILE_CLICK:
            brand_id = row.payload.get("brand_id")
            location_id = row.payload.get("location_id")
            brand_name = brand_names.get(brand_id) if isinstance(brand_id, int) else None
            location_label = (
                location_labels.get(location_id) if isinstance(location_id, int) else None
            )
        results.append(
            ActivityEventOut(
                id=row.id,
                event_type=row.event_type,
                created_at=row.created_at,
                payload=row.payload,
                brand_name=brand_name,
                location_label=location_label,
            )
        )

    return UserActivityResponse(
        results=results,
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
        retention_days=ACTIVITY_RETENTION_DAYS,
    )


async def _resolve_names(
    db: AsyncSession, rows: list[UserActivityEvent]
) -> tuple[dict[int, str], dict[int, str]]:
    brand_ids: set[int] = set()
    location_ids: set[int] = set()
    for row in rows:
        if row.event_type != EVENT_TILE_CLICK:
            continue
        brand_id = row.payload.get("brand_id")
        location_id = row.payload.get("location_id")
        if isinstance(brand_id, int):
            brand_ids.add(brand_id)
        if isinstance(location_id, int):
            location_ids.add(location_id)

    brand_names: dict[int, str] = {}
    if brand_ids:
        brand_names = {
            brand_id: name
            for brand_id, name in (
                await db.execute(
                    select(RestaurantBrand.id, RestaurantBrand.name).where(
                        RestaurantBrand.id.in_(brand_ids)
                    )
                )
            ).all()
        }

    location_labels: dict[int, str] = {}
    if location_ids:
        location_labels = {
            location_id: f"{address}, {city}"
            for location_id, address, city in (
                await db.execute(
                    select(
                        RestaurantLocation.id,
                        RestaurantLocation.address_line1,
                        RestaurantLocation.city,
                    ).where(RestaurantLocation.id.in_(location_ids))
                )
            ).all()
        }
    return brand_names, location_labels


async def list_user_activity_for_export(
    db: AsyncSession, user_sub: str
) -> list[UserActivityEvent]:
    """Every retained (within-window) event for one user, newest first —
    shared by CCPA export and both deletion-scope computations."""
    return list(
        (
            await db.execute(
                select(UserActivityEvent)
                .where(
                    UserActivityEvent.user_sub == user_sub,
                    UserActivityEvent.created_at >= retention_cutoff(),
                )
                .order_by(UserActivityEvent.created_at.desc(), UserActivityEvent.id.desc())
            )
        )
        .scalars()
        .all()
    )
