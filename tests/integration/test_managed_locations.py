"""Integration test: GET /auth/me/managed-locations — the manager
location-discovery endpoint added to close the gap tracked in
docs/PROJECT_PLAN.csv ("User profile / account details page" /
"Owner portal dashboard" rows: no endpoint let a manager discover which
locations they're assigned to). Run against the real HTTP router + a real
(SQLite) DB, same pattern as test_manager_permissions.py.
"""
from __future__ import annotations

import uuid

import pytest

from factories import create_brand, create_location, create_location_manager, create_owner


@pytest.mark.asyncio
async def test_manager_sees_only_their_actively_assigned_locations(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    assigned = await create_location(db_session, brand_id=brand.id, location_name="Assigned Spot")
    unassigned = await create_location(db_session, brand_id=brand.id, location_name="Someone Else's")
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=assigned.id, user_id=manager_sub, is_active=True)
    # Another manager assigned to the unrelated location — must not leak into this caller's list.
    await create_location_manager(db_session, location_id=unassigned.id, user_id=str(uuid.uuid4()), is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.get("/auth/me/managed-locations")
    assert response.status_code == 200, response.text
    body = response.json()
    ids = [row["id"] for row in body["results"]]
    assert ids == [assigned.id]
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 20


@pytest.mark.asyncio
async def test_soft_removed_assignment_is_excluded(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(
        db_session, location_id=location.id, user_id=manager_sub, is_active=False
    )
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.get("/auth/me/managed-locations")
    assert response.status_code == 200, response.text
    assert response.json()["results"] == []
    assert response.json()["total"] == 0


@pytest.mark.asyncio
async def test_soft_deleted_location_is_excluded(client, db_session, as_user):
    """A location the manager is still actively assigned to, but which the
    owner/admin has soft-deleted (`is_active=false`), shouldn't surface here.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, is_active=False)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.get("/auth/me/managed-locations")
    assert response.status_code == 200, response.text
    assert response.json()["results"] == []


@pytest.mark.asyncio
async def test_non_manager_caller_gets_empty_page_not_403(client, db_session, as_user):
    """Any authenticated user can call this — it's self-scoped, not
    role-gated. An owner/admin/registered_user with no location_manager
    rows just gets an empty page.
    """
    owner = await create_owner(db_session)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/auth/me/managed-locations")
    assert response.status_code == 200, response.text
    assert response.json()["results"] == []
    assert response.json()["total"] == 0


@pytest.mark.asyncio
async def test_unauthenticated_caller_is_rejected(client, as_anonymous):
    response = await client.get("/auth/me/managed-locations")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_pagination_defaults_and_page_size(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    manager_sub = str(uuid.uuid4())
    locations = []
    for _ in range(3):
        loc = await create_location(db_session, brand_id=brand.id)
        await create_location_manager(db_session, location_id=loc.id, user_id=manager_sub, is_active=True)
        locations.append(loc)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.get("/auth/me/managed-locations", params={"page": 1, "page_size": 2})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 3
    assert body["page_size"] == 2
    assert len(body["results"]) == 2

    response_page_2 = await client.get("/auth/me/managed-locations", params={"page": 2, "page_size": 2})
    assert len(response_page_2.json()["results"]) == 1


@pytest.mark.asyncio
async def test_page_size_over_max_is_rejected(client, as_user):
    as_user("manager")
    response = await client.get("/auth/me/managed-locations", params={"page_size": 101})
    assert response.status_code == 422
