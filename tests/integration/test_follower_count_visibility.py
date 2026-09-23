"""Integration tests: `follower_count` visibility on
`RestaurantOut`/`ManagedLocationOut` — dashboard-only stat (owner's/
manager's own restaurants), never public. See
docs/API_CONTRACTS.md "GET /restaurants" / "GET /restaurants/{id}" /
"GET /auth/me/managed-locations" and
`backend/app/services/restaurant_service._caller_may_view_follower_count`
for the caller-aware gating mechanism this covers.
"""
from __future__ import annotations

import uuid

import pytest

from factories import (
    create_brand,
    create_follow,
    create_location,
    create_location_manager,
    create_owner,
)


@pytest.mark.asyncio
async def test_owner_sees_follower_count_on_owner_scoped_list(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()
    for _ in range(3):
        await create_follow(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/restaurants")
    assert response.status_code == 200, response.text
    row = response.json()["results"][0]
    assert row["id"] == brand.id
    assert row["follower_count"] == 3


@pytest.mark.asyncio
async def test_admin_sees_follower_count_on_owner_scoped_list(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()
    await create_follow(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("admin")
    response = await client.get(f"/restaurants?owner_id={owner.id}")
    assert response.status_code == 200, response.text
    row = response.json()["results"][0]
    assert row["follower_count"] == 1


@pytest.mark.asyncio
async def test_public_single_restaurant_endpoint_never_includes_follower_count(
    client, db_session, as_user
):
    """The security-sensitive case the task calls out explicitly: a
    DIFFERENT owner's public `GET /restaurants/{id}` for someone else's
    brand must not leak `follower_count` — the field is present (schema
    stability) but always `null`.
    """
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True)
    await db_session.commit()
    await create_follow(db_session, brand_id=brand.id)
    await create_follow(db_session, brand_id=brand.id)
    await db_session.commit()

    # A different owner, hitting the public detail endpoint for owner_a's brand.
    as_user("owner", sub=owner_b.cognito_sub, email=owner_b.email)
    response = await client.get(f"/restaurants/{brand.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert "follower_count" in body
    assert body["follower_count"] is None


@pytest.mark.asyncio
async def test_public_single_restaurant_endpoint_hides_follower_count_from_owning_owner_too(
    client, db_session, as_user
):
    """Even the OWNING owner gets `null` on the public detail endpoint —
    this field is scoped to the dashboard list endpoint (`GET
    /restaurants`), not to "am I the owner," per the task's explicit
    "dashboard only" requirement. The owner sees the real count via
    `GET /restaurants` instead (covered above)."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()
    await create_follow(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get(f"/restaurants/{brand.id}")
    assert response.status_code == 200, response.text
    assert response.json()["follower_count"] is None


@pytest.mark.asyncio
async def test_anonymous_caller_gets_null_follower_count(client, db_session, as_anonymous):
    brand = await create_brand(db_session, is_claimed=True)
    await db_session.commit()
    await create_follow(db_session, brand_id=brand.id)
    await db_session.commit()

    response = await client.get(f"/restaurants/{brand.id}")
    assert response.status_code == 200, response.text
    assert response.json()["follower_count"] is None


@pytest.mark.asyncio
async def test_manager_sees_follower_count_only_for_assigned_locations(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand_assigned = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    brand_unassigned = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    assigned_location = await create_location(
        db_session, brand_id=brand_assigned.id, location_name="Assigned Spot"
    )
    unassigned_location = await create_location(
        db_session, brand_id=brand_unassigned.id, location_name="Not Mine"
    )

    manager_sub = str(uuid.uuid4())
    await create_location_manager(
        db_session, location_id=assigned_location.id, user_id=manager_sub, is_active=True
    )
    # A different manager assigned to the other location — must not leak in.
    await create_location_manager(
        db_session, location_id=unassigned_location.id, user_id=str(uuid.uuid4()), is_active=True
    )
    await db_session.commit()

    for _ in range(2):
        await create_follow(db_session, brand_id=brand_assigned.id)
    await create_follow(db_session, brand_id=brand_unassigned.id)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.get("/auth/me/managed-locations")
    assert response.status_code == 200, response.text
    body = response.json()

    ids = [row["id"] for row in body["results"]]
    assert ids == [assigned_location.id]
    assert body["results"][0]["follower_count"] == 2


@pytest.mark.asyncio
async def test_manager_managed_locations_never_returns_a_different_managers_row(
    client, db_session, as_user
):
    """Sanity check that the follower_count addition doesn't change the
    existing manager-scoping guarantee (tests/CLAUDE.md "ALWAYS test role
    boundaries") — a manager only ever sees rows (and counts) for their OWN
    active assignments, never another manager's."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    other_location = await create_location(db_session, brand_id=brand.id)
    await create_location_manager(
        db_session, location_id=other_location.id, user_id=str(uuid.uuid4()), is_active=True
    )
    await db_session.commit()

    as_user("manager", sub=str(uuid.uuid4()))
    response = await client.get("/auth/me/managed-locations")
    assert response.status_code == 200, response.text
    assert response.json()["results"] == []
