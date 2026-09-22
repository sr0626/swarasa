"""Integration test: owner can edit basic listing info (free tier), and an
owner cannot access another owner's listing — tests/CLAUDE.md Phase 1
required coverage, run against the real HTTP router + a real (SQLite) DB.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from factories import create_brand, create_location, create_owner


@pytest.mark.asyncio
async def test_owner_can_edit_basic_listing_info_on_free_tier(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, is_paid=False, phone="+14695550000")
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch(
        f"/locations/{location.id}",
        json={"phone": "+14695551111", "address_line1": "456 Renovated Ave"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["phone"] == "+14695551111"
    assert body["address_line1"] == "456 Renovated Ave"
    # Free-tier editing must not silently grant paid-tier status.
    assert body["is_paid"] is False

    refreshed = (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location.id))
    ).scalar_one()
    assert refreshed.phone == "+14695551111"
    assert refreshed.is_paid is False


@pytest.mark.asyncio
async def test_owner_can_edit_restaurant_brand_basic_info(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, description="Old description")
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch(f"/restaurants/{brand.id}", json={"description": "New description"})
    assert response.status_code == 200, response.text
    assert response.json()["description"] == "New description"


@pytest.mark.asyncio
async def test_owner_cannot_edit_another_owners_location(client, db_session, as_user):
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand_b = await create_brand(db_session, owner_id=owner_b.id, is_claimed=True)
    location_b = await create_location(db_session, brand_id=brand_b.id)
    await db_session.commit()

    as_user("owner", sub=owner_a.cognito_sub, email=owner_a.email)
    response = await client.patch(f"/locations/{location_b.id}", json={"phone": "(972) 555-0000"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_owner_cannot_delete_another_owners_location(client, db_session, as_user):
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand_b = await create_brand(db_session, owner_id=owner_b.id, is_claimed=True)
    location_b = await create_location(db_session, brand_id=brand_b.id)
    await db_session.commit()

    as_user("owner", sub=owner_a.cognito_sub, email=owner_a.email)
    response = await client.delete(f"/locations/{location_b.id}")
    assert response.status_code == 403

    refreshed = (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location_b.id))
    ).scalar_one()
    assert refreshed.is_active is True  # untouched


@pytest.mark.asyncio
async def test_owner_cannot_edit_another_owners_restaurant_brand(client, db_session, as_user):
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand_b = await create_brand(db_session, owner_id=owner_b.id, is_claimed=True, name="Owner B's Place")
    await db_session.commit()

    as_user("owner", sub=owner_a.cognito_sub, email=owner_a.email)
    response = await client.patch(f"/restaurants/{brand_b.id}", json={"name": "Hijacked Name"})
    assert response.status_code == 403

    refreshed = (
        await db_session.execute(select(RestaurantBrand).where(RestaurantBrand.id == brand_b.id))
    ).scalar_one()
    assert refreshed.name == "Owner B's Place"


@pytest.mark.asyncio
async def test_owner_cannot_add_location_to_another_owners_brand(client, db_session, as_user):
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand_b = await create_brand(db_session, owner_id=owner_b.id, is_claimed=True)
    await db_session.commit()

    as_user("owner", sub=owner_a.cognito_sub, email=owner_a.email)
    response = await client.post(
        "/locations",
        json={
            "brand_id": brand_b.id,
            "address_line1": "1 Sneaky St",
            "city": "Plano",
            "state": "TX",
            "postal_code": "75024",
            "phone": "+12145550100",
        },
    )
    assert response.status_code == 403
