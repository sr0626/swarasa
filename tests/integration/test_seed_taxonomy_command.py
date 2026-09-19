"""Integration test: `seed_taxonomy` seeding logic against the per-test
SQLite session (no PostGIS function involved, so SQLite is faithful here).
Asserts insert-if-missing idempotency and that the seeded rows surface
through the real `GET /cuisine-tags` endpoint.
"""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.cuisine_tag import CuisineTag
from app.scripts import seed_taxonomy
from factories import create_cuisine_tag


@pytest.mark.asyncio
async def test_seeds_every_taxonomy_tag_and_is_idempotent(db_session):
    tags = seed_taxonomy.load_taxonomy()

    first = await seed_taxonomy.seed_taxonomy_tags(db_session, tags)
    assert first == {"inserted": len(tags), "already_present": 0}

    second = await seed_taxonomy.seed_taxonomy_tags(db_session, tags)
    assert second == {"inserted": 0, "already_present": len(tags)}

    total = (await db_session.execute(select(func.count()).select_from(CuisineTag))).scalar_one()
    assert total == len(tags)


@pytest.mark.asyncio
async def test_existing_rows_are_not_overwritten(db_session):
    # An admin has renamed + deactivated "andhra" since the first seed.
    await create_cuisine_tag(
        db_session, name="andhra", display_name="Custom Andhra", category="regional", is_active=False
    )

    tags = seed_taxonomy.load_taxonomy()
    counts = await seed_taxonomy.seed_taxonomy_tags(db_session, tags)

    assert counts == {"inserted": len(tags) - 1, "already_present": 1}
    row = (await db_session.execute(select(CuisineTag).where(CuisineTag.name == "andhra"))).scalar_one()
    assert row.display_name == "Custom Andhra"
    assert row.is_active is False


@pytest.mark.asyncio
async def test_seeded_tags_are_served_by_cuisine_tags_endpoint(client, db_session, as_anonymous):
    tags = seed_taxonomy.load_taxonomy()
    await seed_taxonomy.seed_taxonomy_tags(db_session, tags)
    await db_session.commit()

    response = await client.get("/cuisine-tags?category=type")
    assert response.status_code == 200, response.text
    names = {row["name"] for row in response.json()["results"]}
    assert "food_truck" in names
    assert names == {t["name"] for t in tags if t["category"] == "type"}
