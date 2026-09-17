"""Integration tests: `/restaurants/{id}/follow` and `/auth/me/follows` —
see docs/API_CONTRACTS.md "Follows". Covers the role boundary
(registered_user only), idempotency of both follow and unfollow, the
404-on-unknown-brand case, and the paginated "my follows" list — the same
shape of coverage tests/CLAUDE.md's "Integration test: manager permission
boundary" pattern already establishes for `location_manager`.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.user_follow import UserFollow
from factories import create_brand, create_follow, create_owner


@pytest.mark.asyncio
async def test_registered_user_can_follow_a_brand(client, db_session, as_user):
    brand = await create_brand(db_session)
    await db_session.commit()

    user = as_user("registered_user")
    response = await client.post(f"/restaurants/{brand.id}/follow")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["brand_id"] == brand.id
    assert body["followed_at"]

    row = (
        await db_session.execute(
            select(UserFollow).where(
                UserFollow.user_id == user.cognito_sub, UserFollow.brand_id == brand.id
            )
        )
    ).scalar_one()
    assert row is not None


@pytest.mark.asyncio
async def test_follow_is_idempotent(client, db_session, as_user):
    """Following an already-followed brand succeeds again (no 409/500) and
    does not create a second row."""
    brand = await create_brand(db_session)
    await db_session.commit()

    user = as_user("registered_user")
    first = await client.post(f"/restaurants/{brand.id}/follow")
    second = await client.post(f"/restaurants/{brand.id}/follow")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["followed_at"] == second.json()["followed_at"]

    count = (
        await db_session.execute(
            select(UserFollow).where(
                UserFollow.user_id == user.cognito_sub, UserFollow.brand_id == brand.id
            )
        )
    ).scalars().all()
    assert len(count) == 1


@pytest.mark.asyncio
async def test_follow_unknown_brand_returns_404(client, db_session, as_user):
    as_user("registered_user")
    response = await client.post("/restaurants/999999/follow")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


@pytest.mark.asyncio
async def test_owner_cannot_follow_a_brand(client, db_session, as_user):
    """Root CLAUDE.md "Permission model": follow is a registered_user
    capability, not an owner one."""
    brand = await create_brand(db_session)
    await db_session.commit()

    as_user("owner")
    response = await client.post(f"/restaurants/{brand.id}/follow")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_registered_user_can_unfollow_a_brand(client, db_session, as_user):
    brand = await create_brand(db_session)
    await db_session.commit()
    user_sub = str(uuid.uuid4())
    await create_follow(db_session, user_id=user_sub, brand_id=brand.id)
    await db_session.commit()

    as_user("registered_user", sub=user_sub)
    response = await client.delete(f"/restaurants/{brand.id}/follow")

    assert response.status_code == 204

    remaining = (
        await db_session.execute(
            select(UserFollow).where(
                UserFollow.user_id == user_sub, UserFollow.brand_id == brand.id
            )
        )
    ).scalar_one_or_none()
    assert remaining is None


@pytest.mark.asyncio
async def test_unfollow_when_not_following_is_a_noop(client, db_session, as_user):
    """Idempotent unfollow — a brand the caller never followed (or that
    doesn't exist) returns 204, not 404/409."""
    brand = await create_brand(db_session)
    await db_session.commit()

    as_user("registered_user")
    response = await client.delete(f"/restaurants/{brand.id}/follow")
    assert response.status_code == 204

    unfollow_unknown_brand = await client.delete("/restaurants/999999/follow")
    assert unfollow_unknown_brand.status_code == 204


@pytest.mark.asyncio
async def test_manager_cannot_unfollow(client, db_session, as_user):
    brand = await create_brand(db_session)
    await db_session.commit()

    as_user("manager")
    response = await client.delete(f"/restaurants/{brand.id}/follow")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_list_my_follows_returns_only_my_own(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand_a = await create_brand(db_session, owner_id=owner.id, name="Spice Garden")
    brand_b = await create_brand(db_session, owner_id=owner.id, name="Curry House")
    await db_session.commit()

    user_sub = str(uuid.uuid4())
    other_sub = str(uuid.uuid4())
    await create_follow(db_session, user_id=user_sub, brand_id=brand_a.id)
    await create_follow(db_session, user_id=user_sub, brand_id=brand_b.id)
    await create_follow(db_session, user_id=other_sub, brand_id=brand_a.id)
    await db_session.commit()

    as_user("registered_user", sub=user_sub)
    response = await client.get("/auth/me/follows")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 2
    brand_ids = {row["brand_id"] for row in body["results"]}
    assert brand_ids == {brand_a.id, brand_b.id}


@pytest.mark.asyncio
async def test_list_my_follows_is_paginated(client, db_session, as_user):
    user_sub = str(uuid.uuid4())
    for _ in range(3):
        brand = await create_brand(db_session)
        await db_session.flush()
        await create_follow(db_session, user_id=user_sub, brand_id=brand.id)
    await db_session.commit()

    as_user("registered_user", sub=user_sub)
    response = await client.get("/auth/me/follows?page=1&page_size=2")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["results"]) == 2


@pytest.mark.asyncio
async def test_admin_cannot_list_own_follows_endpoint(client, db_session, as_user):
    """Admin has no `user_follow` use case — same role gate as
    follow/unfollow above."""
    as_user("admin")
    response = await client.get("/auth/me/follows")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_follow_requires_auth(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    await db_session.commit()

    response = await client.post(f"/restaurants/{brand.id}/follow")
    assert response.status_code == 401
