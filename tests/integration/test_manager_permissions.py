"""Integration test: manager permission boundary — 403 on an unassigned
location, 200 on an assigned one. tests/CLAUDE.md's own documented
"Integration test: manager permission boundary" key pattern, run here
against the real HTTP router (`PATCH /locations/{id}`) + real
`require_location_write_access` dependency + a real (SQLite) DB, rather
than a hand-rolled DB-less mock (that version lives in
tests/unit/test_permission_gates.py).
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.restaurant_location import RestaurantLocation
from factories import create_brand, create_location, create_location_manager, create_owner


@pytest.mark.asyncio
async def test_manager_cannot_access_unassigned_location(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location_a = await create_location(db_session, brand_id=brand.id)
    location_b = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location_a.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    # Valid phone shape -- this test is only about the permission
    # boundary, not phone validation, and shouldn't rely on the 403 from
    # the permission dependency happening to be raised before body
    # validation would separately reject an invalid number.
    response = await client.patch(f"/locations/{location_b.id}", json={"phone": "(972) 555-1234"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_manager_can_access_assigned_location(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    # "555-9876" alone (no area code) isn't a dialable NANP number and is
    # now rejected by LocationUpdate's phone validator (phone required
    # going forward, see backend/app/schemas/location.py) -- use a
    # plausible number instead; this test is about the manager permission
    # boundary, not phone format.
    response = await client.patch(f"/locations/{location.id}", json={"phone": "(972) 555-9876"})
    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "+19725559876"

    refreshed = (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location.id))
    ).scalar_one()
    assert refreshed.phone == "+19725559876"


@pytest.mark.asyncio
async def test_revoked_manager_assignment_is_rejected(client, db_session, as_user):
    """root/DECISIONS.md "Manager permissions validated server-side on every
    write (not JWT-only)": a *revoked* (is_active=False) assignment row must
    not grant access even though a row for that user/location exists.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(
        db_session, location_id=location.id, user_id=manager_sub, is_active=False
    )
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.patch(f"/locations/{location.id}", json={"phone": "(972) 555-0000"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_manager_can_edit_hours_for_assigned_location_only(client, db_session, as_user):
    """The same permission dependency also guards PUT /locations/{id}/hours
    (docs/API_CONTRACTS.md) — spot-check it isn't only wired for PATCH.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    assigned = await create_location(db_session, brand_id=brand.id)
    unassigned = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=assigned.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    hours_body = {"hours": [{"day_of_week": 0, "open_time": "11:00:00", "close_time": "22:00:00", "is_closed": False}]}

    as_user("manager", sub=manager_sub)
    ok = await client.put(f"/locations/{assigned.id}/hours", json=hours_body)
    assert ok.status_code == 200, ok.text

    forbidden = await client.put(f"/locations/{unassigned.id}/hours", json=hours_body)
    assert forbidden.status_code == 403


@pytest.mark.asyncio
async def test_manager_cannot_delete_location_even_if_assigned(client, db_session, as_user):
    """docs/API_CONTRACTS.md "DELETE /locations/{id}": owner or admin only —
    no manager path at all, unlike PATCH/hours/photos.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.delete(f"/locations/{location.id}")
    assert response.status_code == 403
