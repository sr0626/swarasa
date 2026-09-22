"""Integration test: restaurant_location.phone is required on
POST /locations (same standing as address_line1/city) and, on
PATCH /locations/{id}, optional-to-omit but rejected if sent
empty/null — docs/API_CONTRACTS.md "POST /locations" and
"PATCH /locations/{id}", docs/PROJECT_PLAN.csv "Make location phone
required".
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.restaurant_location import RestaurantLocation
from factories import create_brand, create_location, create_owner


async def _owned_brand(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()
    return owner, brand


def _create_body(brand_id: int, **overrides) -> dict:
    body = {
        "brand_id": brand_id,
        "address_line1": "500 Legacy Dr",
        "city": "Plano",
        "state": "TX",
        "postal_code": "75024",
        "country": "US",
        "timezone": "America/Chicago",
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_create_location_missing_phone_is_rejected(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.post("/locations", json=_create_body(brand.id))
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_create_location_empty_phone_is_rejected(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.post("/locations", json=_create_body(brand.id, phone=""))
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_create_location_null_phone_is_rejected(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.post("/locations", json=_create_body(brand.id, phone=None))
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_create_location_unparseable_phone_is_rejected(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.post("/locations", json=_create_body(brand.id, phone="not a phone"))
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_create_location_with_valid_phone_is_normalised_to_e164(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.post(
        "/locations", json=_create_body(brand.id, phone="(214) 555-0142")
    )
    assert response.status_code == 201, response.text
    assert response.json()["phone"] == "+12145550142"

    row = (
        await db_session.execute(
            select(RestaurantLocation).where(RestaurantLocation.id == response.json()["id"])
        )
    ).scalar_one()
    assert row.phone == "+12145550142"


@pytest.mark.asyncio
async def test_patch_omitting_phone_leaves_it_untouched(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, phone="+14695550000")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch(f"/locations/{location.id}", json={"city": "Frisco"})
    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "+14695550000"
    assert response.json()["city"] == "Frisco"


@pytest.mark.asyncio
async def test_patch_empty_phone_is_rejected_not_cleared(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, phone="+14695550000")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch(f"/locations/{location.id}", json={"phone": ""})
    assert response.status_code == 422, response.text

    row = (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location.id))
    ).scalar_one()
    await db_session.refresh(row)
    assert row.phone == "+14695550000"


@pytest.mark.asyncio
async def test_patch_null_phone_is_rejected_not_cleared(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, phone="+14695550000")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch(f"/locations/{location.id}", json={"phone": None})
    assert response.status_code == 422, response.text

    row = (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location.id))
    ).scalar_one()
    await db_session.refresh(row)
    assert row.phone == "+14695550000"


@pytest.mark.asyncio
async def test_patch_with_valid_phone_updates_and_normalises(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, phone="+14695550000")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch(
        f"/locations/{location.id}", json={"phone": "972.555.0199"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "+19725550199"


@pytest.mark.asyncio
async def test_patch_invalid_phone_is_rejected(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, phone="+14695550000")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch(f"/locations/{location.id}", json={"phone": "12345"})
    assert response.status_code == 422, response.text

    row = (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location.id))
    ).scalar_one()
    await db_session.refresh(row)
    assert row.phone == "+14695550000"


@pytest.mark.asyncio
async def test_existing_null_phone_row_is_not_touched_by_this_change(client, db_session):
    """Seeded/imported locations with phone IS NULL (bypassing LocationCreate
    entirely, e.g. the CSV bulk-import path) are unaffected -- GET still
    returns `phone: null` for them, no backfill performed.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, phone=None)
    await db_session.commit()

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    assert response.json()["phone"] is None
