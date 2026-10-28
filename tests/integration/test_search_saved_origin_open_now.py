"""Integration (SQLite) tests: saved ZIP/city search origin + the bulk
today's-hours lookup behind `open_now`, plus GET /search wiring.

The PostGIS radius query is stubbed (see test_search_api.py for the real
Postgres-only coverage); everything else runs against the real DB layer."""
from __future__ import annotations

from datetime import datetime, time, timezone

import pytest

from app.models.restaurant_hours import RestaurantHours
from app.services import hours_service, search_service
from factories import create_brand, create_location

NOW_UTC = datetime(2026, 10, 28, 18, 0, tzinfo=timezone.utc)  # Wed 13:00 Chicago


async def _loc(db, brand, **kw):
    return await create_location(db, brand_id=brand.id, **kw)


@pytest.mark.asyncio
async def test_saved_zip_origin_is_centroid_of_active_geocoded_locations(db_session):
    brand = await create_brand(db_session)
    await _loc(db_session, brand, postal_code="75201", latitude=32.0, longitude=-96.0)
    await _loc(db_session, brand, postal_code="75201-1234", latitude=34.0, longitude=-98.0)
    await _loc(db_session, brand, postal_code="75201", latitude=50.0, longitude=-50.0, is_active=False)
    await _loc(db_session, brand, postal_code="75202", latitude=10.0, longitude=10.0)
    lat, lng, source = await search_service.resolve_saved_origin(db_session, "75201", None)
    assert (lat, lng, source) == (33.0, -97.0, "saved_zip")


@pytest.mark.asyncio
async def test_saved_origin_falls_back_to_city_then_none(db_session):
    brand = await create_brand(db_session)
    await _loc(db_session, brand, city="Plano", postal_code="75024", latitude=33.0, longitude=-96.8)
    lat, lng, source = await search_service.resolve_saved_origin(db_session, "99999", "  plano ")
    assert (lat, lng, source) == (33.0, -96.8, "saved_city")
    assert await search_service.resolve_saved_origin(db_session, "99999", "Nowhere") is None
    assert await search_service.resolve_saved_origin(db_session, "not-a-zip", None) is None
    assert await search_service.resolve_saved_origin(db_session, None, None) is None


@pytest.mark.asyncio
async def test_today_hours_bulk_lookup_uses_each_locations_weekday(db_session):
    brand = await create_brand(db_session)
    chi = await _loc(db_session, brand, timezone="America/Chicago")
    tokyo = await _loc(db_session, brand, timezone="Asia/Tokyo")  # already Thursday (3)
    for loc in (chi, tokyo):
        for day in range(7):
            db_session.add(
                RestaurantHours(
                    location_id=loc.id, day_of_week=day,
                    open_time=time(11), close_time=time(22), is_closed=False,
                )
            )
    await db_session.flush()
    pairs = [(chi.id, "America/Chicago"), (tokyo.id, "Asia/Tokyo")]
    got = await hours_service.get_today_hours_for_candidates(db_session, pairs, NOW_UTC)
    assert got[chi.id].day_of_week == 2
    assert got[tokyo.id].day_of_week == 3
    # 03:00 in Tokyo -> closed; 13:00 in Chicago -> open.
    assert hours_service.open_now_location_ids(pairs, got, NOW_UTC) == {chi.id}


@pytest.mark.asyncio
async def test_get_search_wires_saved_origin_and_open_now(client, db_session, monkeypatch):
    brand = await create_brand(db_session)
    await _loc(db_session, brand, postal_code="75201", latitude=32.0, longitude=-96.0)
    await db_session.commit()
    seen: dict = {}

    async def _fake_search(
        db, lat, lng, radius, cuisine, dietary, type_, pagination,
        q=None, has_deals_today=None, open_now=None,
    ):
        seen.update(lat=lat, lng=lng, open_now=open_now)
        return [], 0

    monkeypatch.setattr(search_service, "search", _fake_search)

    r = await client.get("/search?near_zip=75201&open_now=true")
    assert r.status_code == 200
    assert r.json()["origin_source"] == "saved_zip"
    assert (seen["lat"], seen["lng"], seen["open_now"]) == (32.0, -96.0, True)

    # Explicit coordinates always win over the saved ZIP.
    r = await client.get("/search?near_zip=75201&lat=33.5&lng=-97.5")
    assert r.json()["origin_source"] == "coordinates"
    assert (seen["lat"], seen["lng"]) == (33.5, -97.5)

    # Unknown ZIP / garbage -> default origin, never an error.
    for qs in ("near_zip=99999", "near_zip=abc&near_city=", ""):
        r = await client.get(f"/search?{qs}")
        assert r.status_code == 200
        assert r.json()["origin_source"] == "default"
        assert seen["lat"] is None
