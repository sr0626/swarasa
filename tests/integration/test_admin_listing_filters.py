"""Integration tests: admin listings management filters on `GET
/restaurants` — docs/API_CONTRACTS.md "GET /restaurants" filters (added
alongside the admin listings management page, `/admin/listings`).

Each new filter (`owner_email`, `name`, `status`, `is_paid`, `city`,
`is_claimed`) is admin-only — silently ignored for a non-admin (owner)
caller, exactly like the pre-existing `owner_id` filter
(`test_restaurant_list.py`'s
`test_non_admin_cannot_widen_owner_filter_via_query_param`). This file
covers each new filter's happy path plus AND-combinations; it does not
re-test the owner-scoping security boundary already covered there, except
for one representative "owner caller ignores new filter" case to confirm
the same posture extends to the new params.
"""
from __future__ import annotations

import pytest

from factories import create_brand, create_location, create_owner


@pytest.mark.asyncio
async def test_admin_can_filter_by_owner_email_substring(client, db_session, as_user):
    owner_a = await create_owner(db_session, email="alice.owner@example.com")
    owner_b = await create_owner(db_session, email="bob.owner@example.com")
    brand_a = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True, name="Alice Brand")
    await create_brand(db_session, owner_id=owner_b.id, is_claimed=True, name="Bob Brand")
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants?owner_email=ALICE.OWNER")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 1
    assert body["results"][0]["id"] == brand_a.id


@pytest.mark.asyncio
async def test_admin_can_filter_by_name_substring_case_insensitive(client, db_session, as_user):
    owner = await create_owner(db_session)
    spice = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Spice Route")
    await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Curry House")
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants?name=spice")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 1
    assert body["results"][0]["id"] == spice.id


@pytest.mark.asyncio
async def test_admin_can_filter_by_status_matches_any_location(client, db_session, as_user):
    """A brand matches `status=coming_soon` if ANY of its locations has
    that status, even if another of its locations is `active`."""
    owner = await create_owner(db_session)
    mixed_brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Mixed Brand")
    await create_location(db_session, brand_id=mixed_brand.id, status="active")
    await create_location(db_session, brand_id=mixed_brand.id, status="coming_soon")

    all_active_brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="All Active")
    await create_location(db_session, brand_id=all_active_brand.id, status="active")
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants?status=coming_soon")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 1
    assert body["results"][0]["id"] == mixed_brand.id


@pytest.mark.asyncio
async def test_admin_can_filter_by_status_owner_deactivated(client, db_session, as_user):
    owner = await create_owner(db_session)
    deactivated_brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Deactivated Brand")
    await create_location(db_session, brand_id=deactivated_brand.id, status="owner_deactivated")

    active_brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Active Brand")
    await create_location(db_session, brand_id=active_brand.id, status="active")
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants?status=owner_deactivated")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 1
    assert body["results"][0]["id"] == deactivated_brand.id


@pytest.mark.asyncio
async def test_admin_can_filter_by_is_paid_matches_any_location(client, db_session, as_user):
    owner = await create_owner(db_session)
    paid_brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Paid Brand")
    await create_location(db_session, brand_id=paid_brand.id, is_paid=True)
    await create_location(db_session, brand_id=paid_brand.id, is_paid=False)

    free_brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Free Brand")
    await create_location(db_session, brand_id=free_brand.id, is_paid=False)
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants?is_paid=true")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 1
    assert body["results"][0]["id"] == paid_brand.id


@pytest.mark.asyncio
async def test_admin_can_filter_by_city_case_insensitive_any_location(client, db_session, as_user):
    """docs/API_CONTRACTS.md judgment call: a brand can have locations in
    multiple cities — `city` matches if ANY location is in that city."""
    owner = await create_owner(db_session)
    multi_city_brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Multi City")
    await create_location(db_session, brand_id=multi_city_brand.id, city="Plano")
    await create_location(db_session, brand_id=multi_city_brand.id, city="Dallas")

    dallas_only_brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Dallas Only")
    await create_location(db_session, brand_id=dallas_only_brand.id, city="Dallas")

    frisco_brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Frisco Brand")
    await create_location(db_session, brand_id=frisco_brand.id, city="Frisco")
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants?city=PLANO")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["results"][0]["id"] == multi_city_brand.id

    response = await client.get("/restaurants?city=dallas")
    assert response.status_code == 200, response.text
    body = response.json()
    ids = {row["id"] for row in body["results"]}
    assert ids == {multi_city_brand.id, dallas_only_brand.id}


@pytest.mark.asyncio
async def test_admin_can_filter_by_is_claimed(client, db_session, as_user):
    claimed = await create_brand(db_session, is_claimed=True, name="Claimed Brand")
    unclaimed = await create_brand(db_session, is_claimed=False, owner_id=None, name="Unclaimed Brand")
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants?is_claimed=false")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 1
    assert body["results"][0]["id"] == unclaimed.id
    assert claimed.id not in {row["id"] for row in body["results"]}


@pytest.mark.asyncio
async def test_admin_combines_filters_with_and(client, db_session, as_user):
    """A brand must satisfy every provided filter, not just one, to prove
    the AND-combining convention (docs/API_CONTRACTS.md "GET /search" facet
    semantics, applied here)."""
    owner = await create_owner(db_session)
    match = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Spice Route Plano")
    await create_location(db_session, brand_id=match.id, city="Plano", is_paid=True, status="active")

    # Right name, wrong city — must be excluded.
    wrong_city = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Spice Route Dallas")
    await create_location(db_session, brand_id=wrong_city.id, city="Dallas", is_paid=True, status="active")

    # Right city, wrong name — must be excluded.
    wrong_name = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Curry House")
    await create_location(db_session, brand_id=wrong_name.id, city="Plano", is_paid=True, status="active")

    # Right name and city, but free tier — must be excluded.
    wrong_tier = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Spice Route Frisco")
    await create_location(db_session, brand_id=wrong_tier.id, city="Plano", is_paid=False, status="active")
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants?name=spice&city=Plano&is_paid=true")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 1
    assert body["results"][0]["id"] == match.id


@pytest.mark.asyncio
async def test_admin_combines_status_and_owner_email(client, db_session, as_user):
    owner_a = await create_owner(db_session, email="target@example.com")
    owner_b = await create_owner(db_session, email="other@example.com")

    match = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True, name="A Brand")
    await create_location(db_session, brand_id=match.id, status="closed_pending_reopen")

    wrong_owner = await create_brand(db_session, owner_id=owner_b.id, is_claimed=True, name="B Brand")
    await create_location(db_session, brand_id=wrong_owner.id, status="closed_pending_reopen")

    wrong_status = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True, name="C Brand")
    await create_location(db_session, brand_id=wrong_status.id, status="active")
    await db_session.commit()

    as_user("admin")
    response = await client.get("/restaurants?status=closed_pending_reopen&owner_email=target")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 1
    assert body["results"][0]["id"] == match.id


@pytest.mark.asyncio
async def test_new_filters_are_ignored_for_owner_caller(client, db_session, as_user):
    """Same admin-only posture as `owner_id`
    (test_restaurant_list.py::test_non_admin_cannot_widen_owner_filter_via_query_param)
    — an owner caller's list stays "my own brands," unaffected by any of
    the new filter params."""
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand_a = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True, name="Owner A Brand")
    await create_location(db_session, brand_id=brand_a.id, city="Dallas", status="owner_deactivated")
    await create_brand(db_session, owner_id=owner_b.id, is_claimed=True, name="Owner B Brand")
    await db_session.commit()

    as_user("owner", sub=owner_a.cognito_sub, email=owner_a.email)
    # Every one of these params, taken at face value, would exclude
    # brand_a (wrong city/status/claim combination) or reach into owner
    # b's data -- none of that should happen; the owner still only sees
    # their own brand, unfiltered by any of these.
    response = await client.get(
        "/restaurants?city=Plano&status=active&is_paid=true&is_claimed=false&name=nope&owner_email=nobody"
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 1
    assert body["results"][0]["id"] == brand_a.id


@pytest.mark.asyncio
async def test_status_filter_rejects_invalid_value(client, db_session, as_user):
    as_user("admin")
    response = await client.get("/restaurants?status=not_a_real_status")
    assert response.status_code == 422
