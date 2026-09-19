"""Backfill coordinates for restaurant locations that have none (NULL `geom`),
so they show up in geo search. Two Lambda management commands share this
module:

- `list_ungeocoded_locations` -- read-only; returns the address fields of
  every active location whose `geom` is NULL.
- `set_location_coordinates`  -- writes `latitude`, `longitude` AND the
  PostGIS `geom` column (the one `/search` actually queries) for a list of
  `{location_id, latitude, longitude}`, one `audit_log` row per changed
  location.

Geocoding itself NEVER happens here. The Lambda sits in private subnets with
no NAT Gateway (root CLAUDE.md "NEVER create a NAT Gateway"), so it cannot
reach Nominatim. `scripts/geocode_missing_locations.py` runs on the HUMAN's
machine: list -> geocode via Nominatim -> set. See that script's docstring
for the exact commands.

Safety properties of `set_location_coordinates`:
- Every entry is validated independently (int id, finite numbers, lat/lng
  ranges, and a plausible-US bounding box -- every location in this
  directory is a US address, so a point in the ocean or another continent
  is almost certainly a bad geocode). A bad entry is reported per item; it
  never aborts the rest of the batch.
- Idempotent: re-sending the same coordinates for an already-geocoded
  location is a no-op (`unchanged`, no audit row). A location that is
  already geocoded to DIFFERENT coordinates is left alone
  (`skipped_already_geocoded`) unless the payload sets `"overwrite": true`,
  so a re-run can never silently move a point someone corrected by hand.
"""
from __future__ import annotations

import math
from decimal import Decimal
from typing import Any, Awaitable, Callable

from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.services import audit_service

ACTOR_ID = "system:geocode_missing_locations"

# (min_lat, max_lat, min_lng, max_lng). Deliberately generous boxes: this is
# a sanity net against wildly wrong geocodes, not a border check.
_US_BOUNDING_BOXES: tuple[tuple[float, float, float, float], ...] = (
    (24.0, 49.6, -125.5, -66.5),   # contiguous US
    (51.0, 71.9, -180.0, -129.0),  # Alaska (west of the antimeridian)
    (18.5, 22.5, -160.7, -154.5),  # Hawaii
)


def is_plausible_us_point(lat: float, lng: float) -> bool:
    return any(lo_lat <= lat <= hi_lat and lo_lng <= lng <= hi_lng for lo_lat, hi_lat, lo_lng, hi_lng in _US_BOUNDING_BOXES)


def _validate_entry(entry: Any) -> tuple[int, float, float] | str:
    """Returns (location_id, lat, lng) or a human-readable rejection reason."""
    if not isinstance(entry, dict):
        return "entry must be an object with location_id, latitude, longitude"
    location_id, lat, lng = entry.get("location_id"), entry.get("latitude"), entry.get("longitude")
    if isinstance(location_id, bool) or not isinstance(location_id, int):
        return "location_id must be an integer"
    for name, value in (("latitude", lat), ("longitude", lng)):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            return f"{name} must be a finite number"
    if not -90.0 <= lat <= 90.0:
        return "latitude out of range (-90..90)"
    if not -180.0 <= lng <= 180.0:
        return "longitude out of range (-180..180)"
    if not is_plausible_us_point(float(lat), float(lng)):
        return "point is outside the plausible US bounding box"
    return location_id, float(lat), float(lng)


def _to_decimal(value: float) -> Decimal:
    # Via str() to avoid binary-float rounding surprises before the
    # Numeric(9, 6) columns -- same helper as location_service.
    return Decimal(str(round(value, 6)))


async def _sync_geom(db: AsyncSession, location_id: int, lat: float, lng: float) -> None:
    """Same statement as `location_service._sync_geom` /
    `restaurant_bulk_import_service._sync_geom` (module-private there, so
    duplicated here, matching the precedent in seed_dev_data.py). Note
    `ST_MakePoint` takes (lng, lat)."""
    await db.execute(
        update(RestaurantLocation)
        .where(RestaurantLocation.id == location_id)
        .values(geom=ST_SetSRID(ST_MakePoint(lng, lat), 4326))
    )


async def list_ungeocoded_locations(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(RestaurantLocation, RestaurantBrand.name)
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(RestaurantLocation.is_active.is_(True))
            .where(RestaurantLocation.geom.is_(None))
            .order_by(RestaurantLocation.id)
        )
    ).all()
    return [
        {
            "id": loc.id,
            "brand_name": brand_name,
            "address_line1": loc.address_line1,
            "address_line2": loc.address_line2,
            "city": loc.city,
            "state": loc.state,
            "postal_code": loc.postal_code,
        }
        for loc, brand_name in rows
    ]


SyncGeom = Callable[[AsyncSession, int, float, float], Awaitable[None]]


async def set_location_coordinates(
    db: AsyncSession,
    entries: list[Any],
    *,
    overwrite: bool = False,
    sync_geom: SyncGeom = _sync_geom,
) -> dict[str, Any]:
    """Flushes but does not commit -- the caller owns the transaction.
    `sync_geom` is injectable only so unit tests can run on SQLite (which
    has no PostGIS functions); production always uses `_sync_geom`."""
    results: list[dict[str, Any]] = []
    seen: set[int] = set()
    for index, entry in enumerate(entries):
        validated = _validate_entry(entry)
        if isinstance(validated, str):
            loc_id = entry.get("location_id") if isinstance(entry, dict) else None
            results.append({"index": index, "location_id": loc_id, "status": "invalid", "detail": validated})
            continue
        location_id, lat, lng = validated
        if location_id in seen:
            results.append(
                {"index": index, "location_id": location_id, "status": "invalid", "detail": "duplicate location_id in payload"}
            )
            continue
        seen.add(location_id)

        # populate_existing: `sync_geom` is a Core UPDATE, so an instance
        # already in the session would otherwise keep a stale `geom`.
        location = await db.get(RestaurantLocation, location_id, populate_existing=True)
        if location is None:
            results.append({"index": index, "location_id": location_id, "status": "not_found"})
            continue

        new_lat, new_lng = _to_decimal(lat), _to_decimal(lng)
        if location.geom is not None:
            if location.latitude == new_lat and location.longitude == new_lng:
                results.append({"index": index, "location_id": location_id, "status": "unchanged"})
                continue
            if not overwrite:
                results.append({"index": index, "location_id": location_id, "status": "skipped_already_geocoded"})
                continue

        old = {
            "latitude": float(location.latitude) if location.latitude is not None else None,
            "longitude": float(location.longitude) if location.longitude is not None else None,
            "had_geom": location.geom is not None,
        }
        location.latitude = new_lat
        location.longitude = new_lng
        await db.flush()
        await sync_geom(db, location_id, lat, lng)
        await audit_service.log(
            db,
            table_name="restaurant_location",
            record_id=location_id,
            action="update",
            actor_id=ACTOR_ID,
            actor_role="admin",
            old_val=old,
            new_val={"latitude": float(new_lat), "longitude": float(new_lng), "has_geom": True},
        )
        results.append({"index": index, "location_id": location_id, "status": "updated"})
    await db.flush()

    summary: dict[str, int] = {}
    for r in results:
        summary[r["status"]] = summary.get(r["status"], 0) + 1
    return {"summary": summary, "results": results}


async def run_list_ungeocoded_locations() -> dict[str, Any]:
    session_factory = get_session_factory()
    async with session_factory() as db:
        locations = await list_ungeocoded_locations(db)
    return {"count": len(locations), "locations": locations}


async def run_set_location_coordinates(entries: list[Any], overwrite: bool = False) -> dict[str, Any]:
    session_factory = get_session_factory()
    async with session_factory() as db:
        result = await set_location_coordinates(db, entries, overwrite=overwrite)
        await db.commit()
    return result
