"""Integration test: `GET /cuisine-tags` (public read list) —
docs/API_CONTRACTS.md "GET /cuisine-tags" (PR #20). Public, `category`
filter optional, `is_active=true` rows only, no pagination.
"""
from __future__ import annotations

import pytest

from factories import create_cuisine_tag


@pytest.mark.asyncio
async def test_public_caller_can_list_cuisine_tags_with_no_auth(client, db_session, as_anonymous):
    await create_cuisine_tag(db_session, name="hyderabadi", display_name="Hyderabadi", category="regional")
    await db_session.commit()

    response = await client.get("/cuisine-tags")
    assert response.status_code == 200, response.text
    body = response.json()
    assert "page" not in body
    assert "total" not in body
    names = {row["name"] for row in body["results"]}
    assert "hyderabadi" in names


@pytest.mark.asyncio
async def test_category_filter_returns_only_matching_category(client, db_session, as_anonymous):
    await create_cuisine_tag(db_session, name="andhra", display_name="Andhra", category="regional")
    await create_cuisine_tag(db_session, name="vegetarian", display_name="Vegetarian", category="dietary")
    await create_cuisine_tag(db_session, name="biryani", display_name="Biryani", category="signature")
    await db_session.commit()

    response = await client.get("/cuisine-tags?category=dietary")
    assert response.status_code == 200, response.text
    body = response.json()

    assert len(body["results"]) == 1
    assert body["results"][0]["name"] == "vegetarian"
    assert body["results"][0]["category"] == "dietary"


@pytest.mark.asyncio
async def test_category_omitted_returns_all_categories(client, db_session, as_anonymous):
    await create_cuisine_tag(db_session, name="andhra", display_name="Andhra", category="regional")
    await create_cuisine_tag(db_session, name="vegetarian", display_name="Vegetarian", category="dietary")
    await db_session.commit()

    response = await client.get("/cuisine-tags")
    assert response.status_code == 200, response.text
    names = {row["name"] for row in response.json()["results"]}
    assert {"andhra", "vegetarian"}.issubset(names)


@pytest.mark.asyncio
async def test_inactive_cuisine_tags_are_excluded(client, db_session, as_anonymous):
    active = await create_cuisine_tag(db_session, name="dosa", display_name="Dosa", category="type", is_active=True)
    await create_cuisine_tag(db_session, name="retired-tag", display_name="Retired Tag", category="type", is_active=False)
    await db_session.commit()

    response = await client.get("/cuisine-tags?category=type")
    assert response.status_code == 200, response.text
    names = {row["name"] for row in response.json()["results"]}
    assert active.name in names
    assert "retired-tag" not in names


@pytest.mark.asyncio
async def test_each_result_row_has_exactly_the_contract_fields(client, db_session, as_anonymous):
    tag = await create_cuisine_tag(db_session, name="dining-lunch", display_name="Lunch", category="dining_time")
    await db_session.commit()

    response = await client.get("/cuisine-tags?category=dining_time")
    assert response.status_code == 200, response.text
    row = response.json()["results"][0]
    assert set(row.keys()) == {"id", "name", "display_name", "category"}
    # `id` is what POST/PATCH /restaurants' `cuisine_tag_ids` picker submits
    # back — must be the real row id, not just present.
    assert row["id"] == tag.id


@pytest.mark.asyncio
async def test_invalid_category_is_rejected(client, as_anonymous):
    response = await client.get("/cuisine-tags?category=not-a-real-category")
    assert response.status_code == 422
