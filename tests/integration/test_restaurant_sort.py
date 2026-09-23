"""Integration tests: `sort=followers` on `GET /restaurants`
(docs/API_CONTRACTS.md "GET /restaurants") — added for the admin
listings "Most followed" sort control (`AdminListingsPanel.tsx`).

`follower_count` was already added to `RestaurantOut` for admin/owner
callers by PR #174 (`restaurant_service._caller_may_view_follower_count`);
this only adds a way to ORDER BY it. Default order (omit `sort`) must stay
unchanged (`id` ascending) -- covered by the pre-existing
`test_restaurant_list.py` tests, not re-tested here.
"""
from __future__ import annotations

import uuid

import pytest

from factories import create_brand, create_follow, create_owner


async def _follow_n_times(db_session, brand_id: int, count: int) -> None:
    for _ in range(count):
        await create_follow(db_session, brand_id=brand_id, user_id=str(uuid.uuid4()))


@pytest.mark.asyncio
async def test_sort_followers_orders_descending(client, db_session, as_user):
    owner = await create_owner(db_session)
    least = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Least Followed")
    most = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Most Followed")
    middle = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Middle Followed")
    await _follow_n_times(db_session, least.id, 1)
    await _follow_n_times(db_session, most.id, 5)
    await _follow_n_times(db_session, middle.id, 3)
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants?sort=followers")
    assert response.status_code == 200, response.text
    body = response.json()

    ids_in_order = [row["id"] for row in body["results"]]
    assert ids_in_order == [most.id, middle.id, least.id]
    counts_in_order = [row["follower_count"] for row in body["results"]]
    assert counts_in_order == [5, 3, 1]


@pytest.mark.asyncio
async def test_sort_followers_ties_broken_by_id_ascending(client, db_session, as_user):
    owner = await create_owner(db_session)
    first = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="First Created")
    second = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Second Created")
    # Neither brand has any followers -- both tie at 0.
    await db_session.commit()
    assert first.id < second.id

    as_user("admin")
    response = await client.get("/restaurants?sort=followers")
    body = response.json()

    ids_in_order = [row["id"] for row in body["results"]]
    first_index = ids_in_order.index(first.id)
    second_index = ids_in_order.index(second.id)
    assert first_index < second_index


@pytest.mark.asyncio
async def test_sort_followers_combines_with_existing_filters(client, db_session, as_user):
    owner = await create_owner(db_session)
    match_low = await create_brand(
        db_session, owner_id=owner.id, is_claimed=True, name="Spice Route Low"
    )
    match_high = await create_brand(
        db_session, owner_id=owner.id, is_claimed=True, name="Spice Route High"
    )
    no_match = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Curry House")
    await _follow_n_times(db_session, match_low.id, 1)
    await _follow_n_times(db_session, match_high.id, 4)
    await _follow_n_times(db_session, no_match.id, 10)
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants?name=spice&sort=followers")
    body = response.json()

    assert body["total"] == 2
    assert [row["id"] for row in body["results"]] == [match_high.id, match_low.id]


@pytest.mark.asyncio
async def test_omitted_sort_keeps_default_id_order(client, db_session, as_user):
    owner = await create_owner(db_session)
    first = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="A")
    second = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="B")
    # Give the second-created brand more followers -- if sort were applied
    # by default this would reorder the results; it must not.
    await _follow_n_times(db_session, second.id, 10)
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants")
    body = response.json()

    assert [row["id"] for row in body["results"]] == [first.id, second.id]


@pytest.mark.asyncio
async def test_invalid_sort_value_rejected(client, db_session, as_user):
    as_user("admin")
    response = await client.get("/restaurants?sort=not_a_real_sort")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_owner_caller_can_also_sort_by_followers(client, db_session, as_user):
    """`sort` is not admin-only, unlike the #177 filters -- an owner
    sorting their own (already owner-scoped) list is fine, since they
    already see follower_count for their own brands."""
    owner = await create_owner(db_session)
    low = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Owner Low")
    high = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Owner High")
    await _follow_n_times(db_session, low.id, 1)
    await _follow_n_times(db_session, high.id, 9)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/restaurants?sort=followers")
    assert response.status_code == 200, response.text
    body = response.json()
    assert [row["id"] for row in body["results"]] == [high.id, low.id]
