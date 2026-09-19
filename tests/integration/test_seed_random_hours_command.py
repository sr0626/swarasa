"""Integration test: seed_random_hours against the per-test SQLite session --
seeds only locations with no hours, never overwrites, and is re-runnable."""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.restaurant_hours import RestaurantHours
from app.scripts.seed_random_hours import seed_random_hours
from factories import create_brand, create_location, create_owner


@pytest.mark.asyncio
async def test_seeds_only_locations_without_hours_and_is_idempotent(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    empty = await create_location(db_session, brand_id=brand.id)
    has_hours = await create_location(db_session, brand_id=brand.id)
    db_session.add(RestaurantHours(location_id=has_hours.id, day_of_week=0, is_closed=None))
    await db_session.flush()

    first = await seed_random_hours(db_session)
    assert first["locations_seeded"] == 1
    assert first["skipped_already_had_hours"] == 1

    seeded = (await db_session.execute(
        select(func.count()).select_from(RestaurantHours).where(RestaurantHours.location_id == empty.id)
    )).scalar_one()
    kept = (await db_session.execute(
        select(func.count()).select_from(RestaurantHours).where(RestaurantHours.location_id == has_hours.id)
    )).scalar_one()
    assert seeded == 7
    assert kept == 1  # the pre-existing row was left alone

    second = await seed_random_hours(db_session)
    assert second["locations_seeded"] == 0
