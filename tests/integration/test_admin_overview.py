"""Integration tests: `GET /admin/overview` — the admin "Platform
Overview" page's aggregate endpoint (docs/API_CONTRACTS.md "Admin
platform overview").

Covers: admin-only auth, brand-grain restaurant/tier counts (matching
`GET /restaurants?status=<x>` / `?is_paid=<x>` totals exactly — the
"any location matches" semantics from PR #177), and the location-grain
per-owner breakdown (a different, deliberately documented grain — see
`app/services/admin_overview_service.py`).
"""
from __future__ import annotations

import pytest

from factories import create_brand, create_location, create_owner


@pytest.mark.asyncio
async def test_requires_admin(client, db_session, as_user):
    as_user("owner")
    assert (await client.get("/admin/overview")).status_code == 403
    as_user("registered_user")
    assert (await client.get("/admin/overview")).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_rejected(client, as_anonymous):
    resp = await client.get("/admin/overview")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_empty_state(client, db_session, as_user):
    as_user("admin")
    resp = await client.get("/admin/overview")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["restaurants"]["total"] == 0
    assert body["restaurants"]["by_status"] == {
        "active": 0,
        "owner_deactivated": 0,
        "coming_soon": 0,
        "closed_pending_reopen": 0,
    }
    assert body["restaurants"]["by_tier"] == {"paid": 0, "free": 0}
    assert body["owners"]["total_owners"] == 0
    assert body["owners"]["results"] == []
    assert body["registered_user_count"] is None


@pytest.mark.asyncio
async def test_restaurant_status_counts_match_any_location_semantics(client, db_session, as_user):
    """A brand with one `active` and one `coming_soon` location is counted
    in BOTH buckets — same non-exclusive "any location matches" semantics
    as `GET /restaurants?status=<x>` (PR #177) — and `total` is a plain
    brand count, unaffected by how many locations each brand has."""
    owner = await create_owner(db_session)
    mixed = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_location(db_session, brand_id=mixed.id, status="active")
    await create_location(db_session, brand_id=mixed.id, status="coming_soon")

    all_active = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_location(db_session, brand_id=all_active.id, status="active")

    no_locations = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/overview")).json()

    assert body["restaurants"]["total"] == 3  # mixed + all_active + no_locations
    assert body["restaurants"]["by_status"]["active"] == 2  # mixed + all_active
    assert body["restaurants"]["by_status"]["coming_soon"] == 1  # mixed only
    assert body["restaurants"]["by_status"]["owner_deactivated"] == 0
    assert body["restaurants"]["by_status"]["closed_pending_reopen"] == 0
    assert no_locations.id  # sanity: brand with zero locations still exists


@pytest.mark.asyncio
async def test_restaurant_status_counts_match_listings_endpoint_totals(client, db_session, as_user):
    """The whole point of the brand-grain choice: this tile's number must
    equal the `total` a click-through to `/admin/listings?status=<x>`
    (`GET /restaurants?status=<x>`) would show."""
    owner = await create_owner(db_session)
    for _ in range(3):
        brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
        await create_location(db_session, brand_id=brand.id, status="closed_pending_reopen")
    other = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_location(db_session, brand_id=other.id, status="active")
    await db_session.commit()

    as_user("admin")
    overview = (await client.get("/admin/overview")).json()
    listings = (await client.get("/restaurants?status=closed_pending_reopen")).json()

    assert overview["restaurants"]["by_status"]["closed_pending_reopen"] == listings["total"] == 3


@pytest.mark.asyncio
async def test_restaurant_tier_counts_match_any_location_semantics(client, db_session, as_user):
    owner = await create_owner(db_session)
    mixed_tier = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_location(db_session, brand_id=mixed_tier.id, is_paid=True)
    await create_location(db_session, brand_id=mixed_tier.id, is_paid=False)

    free_only = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_location(db_session, brand_id=free_only.id, is_paid=False)
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/overview")).json()

    assert body["restaurants"]["by_tier"]["paid"] == 1  # mixed_tier only
    assert body["restaurants"]["by_tier"]["free"] == 2  # mixed_tier + free_only


@pytest.mark.asyncio
async def test_owner_breakdown_counts_locations_not_brands(client, db_session, as_user):
    """Deliberately a different grain from the restaurant/tier counts
    above: an owner with ONE brand that has two `active` locations shows
    restaurant_count=2 and by_status.active=2 here (location-grain), not
    1 (brand-grain) -- see admin_overview_service.py's documented
    judgment call."""
    owner = await create_owner(db_session, email="multi@example.com")
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_location(db_session, brand_id=brand.id, status="active")
    await create_location(db_session, brand_id=brand.id, status="active")
    await create_location(db_session, brand_id=brand.id, status="coming_soon")
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/overview")).json()

    assert body["owners"]["total_owners"] == 1
    item = body["owners"]["results"][0]
    assert item["email"] == "multi@example.com"
    assert item["restaurant_count"] == 3
    assert item["by_status"]["active"] == 2
    assert item["by_status"]["coming_soon"] == 1
    assert item["by_status"]["owner_deactivated"] == 0
    assert item["by_status"]["closed_pending_reopen"] == 0


@pytest.mark.asyncio
async def test_owner_breakdown_status_sums_to_restaurant_count(client, db_session, as_user):
    """Unlike RestaurantOverview.by_status, this grain's counts always sum
    to the owner's restaurant_count -- no double counting."""
    owner = await create_owner(db_session)
    brand_a = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_location(db_session, brand_id=brand_a.id, status="active")
    brand_b = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_location(db_session, brand_id=brand_b.id, status="owner_deactivated")
    await create_location(db_session, brand_id=brand_b.id, status="closed_pending_reopen")
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/overview")).json()
    item = body["owners"]["results"][0]
    assert item["restaurant_count"] == 3
    assert sum(item["by_status"].values()) == item["restaurant_count"]


@pytest.mark.asyncio
async def test_owners_with_no_brand_excluded(client, db_session, as_user):
    """"Total owners" = unique owners with at least one brand -- an
    owner_account row with zero brands (e.g. signed up but never created a
    listing) must not appear."""
    with_brand = await create_owner(db_session, email="has-brand@example.com")
    await create_brand(db_session, owner_id=with_brand.id, is_claimed=True)
    await create_owner(db_session, email="no-brand@example.com")
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/overview")).json()

    assert body["owners"]["total_owners"] == 1
    assert [r["email"] for r in body["owners"]["results"]] == ["has-brand@example.com"]


@pytest.mark.asyncio
async def test_unclaimed_brand_with_no_owner_counted_in_restaurants_not_owners(client, db_session, as_user):
    """An unclaimed, admin-seeded brand (owner_id IS NULL) still counts
    toward restaurants.total, but contributes to no owner's breakdown."""
    unclaimed = await create_brand(db_session, owner_id=None, is_claimed=False)
    await create_location(db_session, brand_id=unclaimed.id, status="active")
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/overview")).json()

    assert body["restaurants"]["total"] == 1
    assert body["restaurants"]["by_status"]["active"] == 1
    assert body["owners"]["total_owners"] == 0
    assert body["owners"]["results"] == []


@pytest.mark.asyncio
async def test_owner_list_is_paginated_and_alphabetical_by_email(client, db_session, as_user):
    for email in ("charlie@example.com", "alice@example.com", "bob@example.com"):
        owner = await create_owner(db_session, email=email)
        await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()

    as_user("admin")
    resp = await client.get("/admin/overview?page=1&page_size=2")
    body = resp.json()
    assert body["owners"]["total_owners"] == 3
    assert body["owners"]["page"] == 1
    assert body["owners"]["page_size"] == 2
    assert len(body["owners"]["results"]) == 2
    assert [r["email"] for r in body["owners"]["results"]] == ["alice@example.com", "bob@example.com"]

    resp2 = await client.get("/admin/overview?page=2&page_size=2")
    body2 = resp2.json()
    assert [r["email"] for r in body2["owners"]["results"]] == ["charlie@example.com"]
