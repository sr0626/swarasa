"""Integration test: restaurant_location.about / specialties — owner,
assigned manager and admin can set them via PATCH /locations/{id}; an
unassigned manager gets 403; validation limits; null/empty clears; GET
returns them; the write is audited.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.restaurant_location import RestaurantLocation
from factories import create_brand, create_location, create_location_manager, create_owner


async def _setup(db_session, **location_overrides):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, **location_overrides)
    await db_session.commit()
    return owner, location


@pytest.mark.asyncio
async def test_new_fields_default_to_null_on_get(client, db_session):
    _, location = await _setup(db_session)
    body = (await client.get(f"/locations/{location.id}")).json()
    assert body["about"] is None
    assert body["specialties"] is None


@pytest.mark.asyncio
async def test_owner_can_set_and_get_returns_them(client, db_session, as_user):
    owner, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch(
        f"/locations/{location.id}",
        json={"about": "  We specialize in Hyderabadi biryani.  ", "specialties": ["Biryani", "Dum cooking"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["about"] == "We specialize in Hyderabadi biryani."
    assert response.json()["specialties"] == ["Biryani", "Dum cooking"]

    got = (await client.get(f"/locations/{location.id}")).json()
    assert got["about"] == "We specialize in Hyderabadi biryani."
    assert got["specialties"] == ["Biryani", "Dum cooking"]

    row = (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location.id))
    ).scalar_one()
    assert row.specialties == ["Biryani", "Dum cooking"]

    audit = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "restaurant_location", AuditLog.record_id == location.id)
        )
    ).scalar_one()
    assert audit.old_val["about"] is None
    assert audit.new_val["about"] == "We specialize in Hyderabadi biryani."
    assert audit.new_val["specialties"] == ["Biryani", "Dum cooking"]


@pytest.mark.asyncio
async def test_assigned_manager_can_set(client, db_session, as_user):
    _, location = await _setup(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.patch(f"/locations/{location.id}", json={"about": "Managed by us", "specialties": ["Dosa"]})
    assert response.status_code == 200, response.text
    assert response.json()["specialties"] == ["Dosa"]


@pytest.mark.asyncio
async def test_unassigned_manager_gets_403(client, db_session, as_user):
    _, location_a = await _setup(db_session)
    location_b = await create_location(db_session, brand_id=location_a.brand_id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location_a.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.patch(f"/locations/{location_b.id}", json={"about": "nope"})
    assert response.status_code == 403
    assert (await client.get(f"/locations/{location_b.id}")).json()["about"] is None


@pytest.mark.asyncio
async def test_admin_can_set(client, db_session, as_user):
    _, location = await _setup(db_session)
    as_user("admin")
    response = await client.patch(f"/locations/{location.id}", json={"specialties": ["Chaat"]})
    assert response.status_code == 200, response.text
    assert response.json()["specialties"] == ["Chaat"]


@pytest.mark.asyncio
async def test_about_length_limit(client, db_session, as_user):
    owner, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    ok = await client.patch(f"/locations/{location.id}", json={"about": "a" * 1000})
    assert ok.status_code == 200, ok.text
    assert len(ok.json()["about"]) == 1000

    too_long = await client.patch(f"/locations/{location.id}", json={"about": "a" * 1001})
    assert too_long.status_code == 422


@pytest.mark.asyncio
async def test_specialties_limits(client, db_session, as_user):
    owner, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    eight = [f"Dish {i}" for i in range(8)]
    ok = await client.patch(f"/locations/{location.id}", json={"specialties": eight})
    assert ok.status_code == 200, ok.text

    nine = [f"Dish {i}" for i in range(9)]
    assert (await client.patch(f"/locations/{location.id}", json={"specialties": nine})).status_code == 422

    too_long_item = await client.patch(f"/locations/{location.id}", json={"specialties": ["x" * 41]})
    assert too_long_item.status_code == 422
    exactly_40 = await client.patch(f"/locations/{location.id}", json={"specialties": ["x" * 40]})
    assert exactly_40.status_code == 200, exactly_40.text


@pytest.mark.asyncio
async def test_specialties_are_trimmed_and_deduplicated(client, db_session, as_user):
    owner, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch(
        f"/locations/{location.id}",
        json={"specialties": ["  Biryani ", "biryani", "", "   ", "Dosa"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["specialties"] == ["Biryani", "Dosa"]


@pytest.mark.asyncio
async def test_clearing_with_null_and_empty_values(client, db_session, as_user):
    owner, location = await _setup(db_session, about="Old about", specialties=["Old"])
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    # Empty string / empty list clear.
    response = await client.patch(f"/locations/{location.id}", json={"about": "", "specialties": []})
    assert response.status_code == 200, response.text
    assert response.json()["about"] is None
    assert response.json()["specialties"] is None

    # Explicit null clears too.
    await client.patch(f"/locations/{location.id}", json={"about": "Again", "specialties": ["Again"]})
    response = await client.patch(f"/locations/{location.id}", json={"about": None, "specialties": None})
    assert response.status_code == 200, response.text
    assert response.json()["about"] is None
    assert response.json()["specialties"] is None

    row = (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location.id))
    ).scalar_one()
    await db_session.refresh(row)
    assert row.about is None and row.specialties is None


@pytest.mark.asyncio
async def test_omitting_fields_leaves_them_untouched(client, db_session, as_user):
    owner, location = await _setup(db_session, about="Keep me", specialties=["Keep"])
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch(f"/locations/{location.id}", json={"phone": "+14695550123"})
    assert response.status_code == 200, response.text
    assert response.json()["about"] == "Keep me"
    assert response.json()["specialties"] == ["Keep"]
