"""Integration test: GET /search geo-radius filtering — tests/CLAUDE.md
Phase 1 required coverage "Geo search returns correct results within 15
miles" / "Geo search excludes results beyond radius" / "Unauthed user can
search."

REQUIRES A REAL POSTGRES + POSTGIS DATABASE. `search_service._fetch_candidates`
queries `restaurant_location.geom` (a PostGIS `Geography` column) with the
real PostGIS SQL functions `ST_DWithin`, `ST_MakePoint`, `ST_SetSRID`, and
`ST_Distance` — none of which exist on SQLite (see
tests/integration/conftest.py's `db_session` fixture, used by every other
integration test file in this suite, and its docstring on exactly why it
can't be reused here).

THIS SANDBOX HAS NO REAL POSTGRES/POSTGIS AVAILABLE (no `psql`/`postgres`
binary, and this task's guardrails prohibit running `docker`/`terraform`/
real AWS to stand one up) — these tests are guarded with
`pytest.mark.skipif` on the `TEST_DATABASE_URL` env var and have NOT been
executed or verified in this sandbox. To actually run/verify them:

    export TEST_DATABASE_URL="postgresql+asyncpg://user:pass@localhost:5432/swarasa_test"
    # against a Postgres with the postgis extension installed (or Aurora's
    # own postgis-enabled instance), then:
    pytest tests/integration/test_search_api.py

The surrounding, non-PostGIS logic of `search_service.search()` (brand
rollup, default sort, pagination) IS covered and passing today, without
any real DB, in tests/unit/test_search_service_logic.py.
"""
from __future__ import annotations

import os

import pytest
import pytest_asyncio
from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.main as app_main
import app.models  # noqa: F401 - registers models on Base.metadata
from app.db.base import Base
from app.dependencies.db import get_db
from app.models.restaurant_location import RestaurantLocation
from factories import create_brand, create_location

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason=(
        "TEST_DATABASE_URL not set — geo-radius search requires a real "
        "Postgres+PostGIS database, not available in this sandbox (no "
        "psql/docker). See this file's module docstring to run it against "
        "one."
    ),
)


@pytest_asyncio.fixture
async def pg_db_session():
    engine = create_async_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    async with engine.begin() as conn:
        await conn.execute(__import__("sqlalchemy").text("CREATE EXTENSION IF NOT EXISTS postgis"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def pg_client(pg_db_session):
    async def _override_get_db():
        yield pg_db_session

    app_main.app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app_main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app_main.app.dependency_overrides.clear()


async def _set_geom(db: AsyncSession, location_id: int, lat: float, lng: float) -> None:
    await db.execute(
        update(RestaurantLocation)
        .where(RestaurantLocation.id == location_id)
        .values(geom=ST_SetSRID(ST_MakePoint(lng, lat), 4326))
    )
    await db.commit()


IRVING_LAT, IRVING_LNG = 32.8140, -96.9489


@pytest.mark.asyncio
async def test_search_returns_locations_within_15_miles(pg_client, pg_db_session):
    brand = await create_brand(pg_db_session, is_claimed=True, name="Near Irving Kitchen")
    near = await create_location(pg_db_session, brand_id=brand.id, is_active=True, is_verified=True)
    await pg_db_session.commit()
    await _set_geom(pg_db_session, near.id, IRVING_LAT + 0.07, IRVING_LNG)  # ~5 mi away

    response = await pg_client.get("/search", params={"lat": IRVING_LAT, "lng": IRVING_LNG, "radius": 15})
    assert response.status_code == 200
    ids = [r["nearest_location"]["location_id"] for r in response.json()["results"]]
    assert near.id in ids


@pytest.mark.asyncio
async def test_search_excludes_locations_beyond_radius(pg_client, pg_db_session):
    brand = await create_brand(pg_db_session, is_claimed=True, name="Far Away Kitchen")
    far = await create_location(pg_db_session, brand_id=brand.id, is_active=True, is_verified=True)
    await pg_db_session.commit()
    await _set_geom(pg_db_session, far.id, IRVING_LAT - 0.30, IRVING_LNG)  # ~21 mi away

    response = await pg_client.get("/search", params={"lat": IRVING_LAT, "lng": IRVING_LNG, "radius": 15})
    assert response.status_code == 200
    ids = [r["nearest_location"]["location_id"] for r in response.json()["results"]]
    assert far.id not in ids


@pytest.mark.asyncio
async def test_search_is_public_no_auth_header_required(pg_client, pg_db_session):
    brand = await create_brand(pg_db_session, is_claimed=True)
    location = await create_location(pg_db_session, brand_id=brand.id, is_active=True)
    await pg_db_session.commit()
    await _set_geom(pg_db_session, location.id, IRVING_LAT, IRVING_LNG)

    # No Authorization header at all — GET /search is a public route
    # (docs/API_CONTRACTS.md "GET /search": "Auth: none (public)").
    response = await pg_client.get("/search", params={"lat": IRVING_LAT, "lng": IRVING_LNG})
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_search_excludes_locations_of_a_soft_deleted_brand(pg_client, pg_db_session):
    """`restaurant_brand.deleted_at` (migration 0011): even a location that is
    still `active` (e.g. re-enabled behind a deleted brand's back) must not
    surface in geo or text search."""
    from datetime import datetime, timezone

    brand = await create_brand(
        pg_db_session,
        is_claimed=True,
        name="Deleted Listing Kitchen",
        deleted_at=datetime.now(timezone.utc),
    )
    loc = await create_location(pg_db_session, brand_id=brand.id, is_active=True, is_verified=True)
    await pg_db_session.commit()
    await _set_geom(pg_db_session, loc.id, IRVING_LAT, IRVING_LNG)

    geo = await pg_client.get("/search", params={"lat": IRVING_LAT, "lng": IRVING_LNG, "radius": 15})
    assert geo.status_code == 200
    assert loc.id not in [r["nearest_location"]["location_id"] for r in geo.json()["results"]]

    text = await pg_client.get("/search", params={"q": "Deleted Listing"})
    assert text.status_code == 200
    assert loc.id not in [r["nearest_location"]["location_id"] for r in text.json()["results"]]


@pytest.mark.asyncio
async def test_search_tag_filter_matches_only_the_branch_that_has_the_tag(pg_client, pg_db_session):
    """Tags are per location (`location_cuisine`, migration 0016). Two branches
    of one brand: the NEARER one (Irving) has no Breakfast Menu tag, the
    farther one (Plano) does. The `cuisine[]` facet is evaluated per location,
    so a Breakfast Menu filter returns the tag-carrying branch as the tile's
    nearest location — never the nearer branch's address — with that branch's
    own tags; a text search on the tag name behaves the same."""
    from app.models.location_cuisine import LocationCuisine
    from factories import create_cuisine_tag

    breakfast = await create_cuisine_tag(
        pg_db_session, name="breakfast_menu", display_name="Breakfast Menu", category="dining_time"
    )
    brand = await create_brand(pg_db_session, is_claimed=True, name="Two Branch Kitchen")
    irving = await create_location(pg_db_session, brand_id=brand.id, is_active=True, slug="irving")
    plano = await create_location(pg_db_session, brand_id=brand.id, is_active=True, slug="plano")
    pg_db_session.add(LocationCuisine(location_id=plano.id, cuisine_tag_id=breakfast.id))
    await pg_db_session.commit()
    await _set_geom(pg_db_session, irving.id, IRVING_LAT + 0.02, IRVING_LNG)  # ~1.4 mi
    await _set_geom(pg_db_session, plano.id, IRVING_LAT + 0.10, IRVING_LNG)  # ~7 mi

    for params in (
        {"lat": IRVING_LAT, "lng": IRVING_LNG, "radius": 15, "cuisine[]": ["breakfast_menu"]},
        {"lat": IRVING_LAT, "lng": IRVING_LNG, "radius": 15, "q": "Breakfast Menu"},
    ):
        response = await pg_client.get("/search", params=params)
        assert response.status_code == 200, response.text
        results = response.json()["results"]
        assert len(results) == 1
        tile = results[0]
        assert tile["nearest_location"]["location_id"] == plano.id
        assert tile["location_count_nearby"] == 1
        assert [t["name"] for t in tile["cuisine_tags"]] == ["breakfast_menu"]

    unfiltered = (
        await pg_client.get("/search", params={"lat": IRVING_LAT, "lng": IRVING_LNG, "radius": 15})
    ).json()["results"]
    assert unfiltered[0]["nearest_location"]["location_id"] == irving.id
    assert unfiltered[0]["cuisine_tags"] == []
