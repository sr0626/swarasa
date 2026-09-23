"""Integration test: `GET /restaurants` (owner-scoped list) —
docs/API_CONTRACTS.md "GET /restaurants" (PR #20, "Owner-scoped restaurant
list"). Security-sensitive: an owner caller must be hard-filtered
server-side to their own brands with NO way to widen that via a
client-supplied `owner_id` query param; only an admin caller may use it.
"""
from __future__ import annotations

import pytest

from factories import create_brand, create_owner


@pytest.mark.asyncio
async def test_owner_sees_only_their_own_brands(client, db_session, as_user):
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand_a1 = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True, name="Owner A Brand One")
    brand_a2 = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True, name="Owner A Brand Two")
    await create_brand(db_session, owner_id=owner_b.id, is_claimed=True, name="Owner B Brand")
    await db_session.commit()

    as_user("owner", sub=owner_a.cognito_sub, email=owner_a.email)
    response = await client.get("/restaurants")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 2
    ids = {row["id"] for row in body["results"]}
    assert ids == {brand_a1.id, brand_a2.id}
    assert all(row["owner_id"] == owner_a.id for row in body["results"])


@pytest.mark.asyncio
async def test_non_admin_cannot_widen_owner_filter_via_query_param(client, db_session, as_user):
    """The security-sensitive case: an owner caller passing another owner's
    `owner_id` must still only see their own brands — the query param is
    silently ignored for a non-admin caller, never applied.
    """
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand_a = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True, name="Owner A Brand")
    await create_brand(db_session, owner_id=owner_b.id, is_claimed=True, name="Owner B Brand")
    await db_session.commit()

    as_user("owner", sub=owner_a.cognito_sub, email=owner_a.email)
    response = await client.get(f"/restaurants?owner_id={owner_b.id}")
    assert response.status_code == 200, response.text
    body = response.json()

    # Still only owner_a's own brand — owner_b's brand must never leak
    # through, even though owner_a explicitly asked for owner_b's id.
    assert body["total"] == 1
    assert body["results"][0]["id"] == brand_a.id
    assert body["results"][0]["owner_id"] == owner_a.id


@pytest.mark.asyncio
async def test_admin_can_filter_by_explicit_owner_id(client, db_session, as_user):
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand_a = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True, name="Owner A Brand")
    await create_brand(db_session, owner_id=owner_b.id, is_claimed=True, name="Owner B Brand")
    await db_session.commit()

    as_user("admin")
    response = await client.get(f"/restaurants?owner_id={owner_a.id}")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 1
    assert body["results"][0]["id"] == brand_a.id


@pytest.mark.asyncio
async def test_admin_omitting_owner_id_returns_all_brands(client, db_session, as_user):
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand_a = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True)
    brand_b = await create_brand(db_session, owner_id=owner_b.id, is_claimed=True)
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 2
    ids = {row["id"] for row in body["results"]}
    assert ids == {brand_a.id, brand_b.id}


@pytest.mark.asyncio
async def test_response_shape_matches_get_restaurant_by_id(client, db_session, as_user):
    """docs/API_CONTRACTS.md: same per-row shape (same keys) as
    `GET /restaurants/{id}`, not a summary/list-trimmed variant.

    `follower_count` is the one field deliberately excluded from the
    otherwise-identical value comparison: it's a dashboard-only stat
    (docs/API_CONTRACTS.md "GET /restaurants" / "GET /restaurants/{id}")
    that's populated on the owner-scoped list but always `null` on the
    public single-restaurant response — see
    `test_follower_count_visibility.py` for the dedicated coverage of that
    behaviour.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Shape Check Brand")
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    list_response = await client.get("/restaurants")
    assert list_response.status_code == 200, list_response.text
    row = list_response.json()["results"][0]

    detail_response = await client.get(f"/restaurants/{brand.id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()

    assert set(row.keys()) == set(detail.keys())
    row_without_follower_count = {k: v for k, v in row.items() if k != "follower_count"}
    detail_without_follower_count = {k: v for k, v in detail.items() if k != "follower_count"}
    assert row_without_follower_count == detail_without_follower_count
    assert row["follower_count"] == 0  # owner-scoped list: dashboard-visible, 0 followers
    assert detail["follower_count"] is None  # public single-restaurant response: never visible


@pytest.mark.asyncio
async def test_list_is_paginated(client, db_session, as_user):
    owner = await create_owner(db_session)
    for i in range(3):
        await create_brand(db_session, owner_id=owner.id, is_claimed=True, name=f"Brand {i}")
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/restaurants?page=1&page_size=2")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["results"]) == 2


@pytest.mark.asyncio
async def test_registered_user_cannot_access_owner_restaurant_list(client, db_session, as_user):
    as_user("registered_user")
    response = await client.get("/restaurants")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_manager_cannot_access_owner_restaurant_list(client, db_session, as_user):
    as_user("manager")
    response = await client.get("/restaurants")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_unauthed_caller_cannot_access_owner_restaurant_list(client, as_anonymous):
    response = await client.get("/restaurants")
    assert response.status_code == 401
