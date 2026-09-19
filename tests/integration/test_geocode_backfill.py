"""Integration tests for the geocode backfill management commands
(app/scripts/geocode_backfill.py) on the SQLite `db_session` fixture.

SQLite has no PostGIS, so `sync_geom` is injected with a fake that writes a
WKT-ish string into the (TEXT-on-SQLite) `geom` column. The real
`_sync_geom` is a one-statement copy of `location_service._sync_geom`; its
SQL shape is asserted separately below by compiling it, not executing it.
No AWS, no network.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from sqlalchemy import select, update
from sqlalchemy.dialects import postgresql

from app.models.audit_log import AuditLog
from app.models.restaurant_location import RestaurantLocation
from app.scripts import geocode_backfill as gb
from factories import create_brand, create_location


async def _fake_sync_geom(db, location_id: int, lat: float, lng: float) -> None:
    await db.execute(
        update(RestaurantLocation)
        .where(RestaurantLocation.id == location_id)
        .values(geom=f"POINT({lng} {lat})")
    )


async def _set(db, entries, **kw):
    return await gb.set_location_coordinates(db, entries, sync_geom=_fake_sync_geom, **kw)


async def _audits(db, location_id: int) -> list[AuditLog]:
    rows = await db.execute(
        select(AuditLog).where(AuditLog.table_name == "restaurant_location", AuditLog.record_id == location_id)
    )
    return list(rows.scalars())


@pytest.mark.asyncio
async def test_list_returns_only_active_locations_with_null_geom(db_session):
    brand = await create_brand(db_session, name="Taj Chaat House")
    missing = await create_location(
        db_session, brand_id=brand.id, address_line1="1 Main St", city="Irving", postal_code="75038"
    )
    await create_location(db_session, brand_id=brand.id, is_active=False)
    done = await create_location(db_session, brand_id=brand.id)
    await _fake_sync_geom(db_session, done.id, 32.8, -96.9)
    await db_session.flush()
    db_session.expire_all()

    result = await gb.list_ungeocoded_locations(db_session)

    assert [r["id"] for r in result] == [missing.id]
    assert result[0] == {
        "id": missing.id,
        "brand_name": "Taj Chaat House",
        "address_line1": "1 Main St",
        "address_line2": None,
        "city": "Irving",
        "state": "TX",
        "postal_code": "75038",
    }


@pytest.mark.asyncio
async def test_set_updates_lat_lng_geom_and_writes_one_audit_row(db_session):
    brand = await create_brand(db_session)
    loc = await create_location(db_session, brand_id=brand.id)

    result = await _set(db_session, [{"location_id": loc.id, "latitude": 32.8123456, "longitude": -96.9}])
    await db_session.flush()

    assert result["summary"] == {"updated": 1}
    fresh = await db_session.get(RestaurantLocation, loc.id, populate_existing=True)
    assert fresh.latitude == Decimal("32.812346") and fresh.longitude == Decimal("-96.9")
    assert fresh.geom is not None and "-96.9 32.8123456" in str(fresh.geom)
    audits = await _audits(db_session, loc.id)
    assert len(audits) == 1
    assert audits[0].action == "update" and audits[0].actor_id == gb.ACTOR_ID
    assert audits[0].old_val["had_geom"] is False and audits[0].new_val["has_geom"] is True
    # Once set, it no longer shows up in the "ungeocoded" list.
    assert await gb.list_ungeocoded_locations(db_session) == []


@pytest.mark.asyncio
async def test_set_is_idempotent_same_coords_no_second_audit(db_session):
    loc = await create_location(db_session, brand_id=(await create_brand(db_session)).id)
    entry = {"location_id": loc.id, "latitude": 32.8, "longitude": -96.9}
    await _set(db_session, [entry])
    again = await _set(db_session, [entry])

    assert again["summary"] == {"unchanged": 1}
    assert len(await _audits(db_session, loc.id)) == 1


@pytest.mark.asyncio
async def test_set_does_not_move_existing_point_unless_overwrite(db_session):
    loc = await create_location(db_session, brand_id=(await create_brand(db_session)).id)
    await _set(db_session, [{"location_id": loc.id, "latitude": 32.8, "longitude": -96.9}])

    skipped = await _set(db_session, [{"location_id": loc.id, "latitude": 33.0, "longitude": -97.0}])
    assert skipped["summary"] == {"skipped_already_geocoded": 1}
    assert (await db_session.get(RestaurantLocation, loc.id)).latitude == Decimal("32.8")

    moved = await _set(db_session, [{"location_id": loc.id, "latitude": 33.0, "longitude": -97.0}], overwrite=True)
    assert moved["summary"] == {"updated": 1}
    assert (await db_session.get(RestaurantLocation, loc.id)).latitude == Decimal("33.0")
    assert len(await _audits(db_session, loc.id)) == 2


@pytest.mark.asyncio
async def test_set_reports_bad_entries_without_aborting_the_batch(db_session):
    loc = await create_location(db_session, brand_id=(await create_brand(db_session)).id)
    entries = [
        {"location_id": 999999, "latitude": 32.8, "longitude": -96.9},          # not found
        {"location_id": loc.id, "latitude": 95.0, "longitude": -96.9},          # lat out of range
        {"location_id": loc.id, "latitude": 51.5, "longitude": -0.12},          # London: outside US box
        {"location_id": loc.id, "latitude": float("nan"), "longitude": -96.9},  # not finite
        {"location_id": loc.id, "latitude": "32.8", "longitude": -96.9},        # wrong type
        {"location_id": "x", "latitude": 32.8, "longitude": -96.9},             # bad id
        "junk",
        {"location_id": loc.id, "latitude": 32.8, "longitude": -96.9},          # good
        {"location_id": loc.id, "latitude": 32.9, "longitude": -96.9},          # duplicate id
    ]
    result = await _set(db_session, entries)

    assert [r["status"] for r in result["results"]] == [
        "not_found", "invalid", "invalid", "invalid", "invalid", "invalid", "invalid", "updated", "invalid",
    ]
    assert result["summary"] == {"not_found": 1, "invalid": 7, "updated": 1}
    assert len(await _audits(db_session, loc.id)) == 1


@pytest.mark.parametrize(
    ("lat", "lng", "ok"),
    [
        (32.85, -96.95, True),   # Dallas
        (61.2, -149.9, True),    # Anchorage
        (21.3, -157.85, True),   # Honolulu
        (0.0, 0.0, False),       # null island
        (28.6, 77.2, False),     # Delhi
        (-96.9, 32.8, False),    # swapped
    ],
)
def test_us_bounding_box(lat, lng, ok):
    assert gb.is_plausible_us_point(lat, lng) is ok


def test_real_sync_geom_builds_makepoint_lng_lat_order():
    """The production helper can't execute on SQLite; compile its statement
    against the Postgres dialect and check the (lng, lat) order + SRID."""
    captured: dict[str, str] = {}

    class _Capture:
        async def execute(self, stmt):
            captured["sql"] = str(
                stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
            )

    asyncio.run(gb._sync_geom(_Capture(), 7, 32.8, -96.9))
    sql = captured["sql"].lower()
    assert "st_setsrid(st_makepoint(-96.9, 32.8), 4326)" in sql
    assert "restaurant_location.id = 7" in sql
