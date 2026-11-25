"""Integration test: unauthenticated read access — tests/CLAUDE.md Phase 1
required coverage "Unauthed user can search and view listings" /
"Unauthed user cannot see deals".

Search itself (`GET /search`) is PostGIS-backed
(`search_service._fetch_candidates` calls real `ST_DWithin`/`ST_MakePoint`
SQL functions that don't exist on SQLite) and so cannot run against this
suite's SQLite fixture — see tests/integration/test_search_api.py, which
covers "unauthed user can search" against a real Postgres+PostGIS database
(guarded/skipped without one). This file covers the "and view listings"
half — `GET /restaurants/{id}`, `GET /restaurants/{id}/locations`,
`GET /locations/{id}` — plus confirming the public/private boundary itself
(an owner-only write route correctly rejects a request with no auth at
all).

"Unauthed user cannot see deals" is N/A for Phase 1: no `deal` model,
service, schema, or router exists anywhere in `backend/app/` on this
branch (root CLAUDE.md "Current Phase": "Do not build Phase 2 features
(payments, deals, analytics) during Phase 1" — deals are explicitly
Phase 2). There is nothing to call and nothing to assert; noted here and in
the QA report as not-applicable rather than silently dropped.
"""
from __future__ import annotations

from factories import create_brand, create_location


async def test_unauthed_user_can_view_a_restaurant(client, db_session, as_anonymous):
    brand = await create_brand(db_session, is_claimed=True, name="Public Spice House")
    await create_location(db_session, brand_id=brand.id)  # public brands need one active location
    await db_session.commit()

    response = await client.get(f"/restaurants/{brand.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == brand.id
    assert body["name"] == "Public Spice House"


async def test_unauthed_user_can_view_a_restaurant_by_slug(client, db_session, as_anonymous):
    """docs/API_CONTRACTS.md "GET /restaurants/{id}" (updated in PR #12,
    docs/restaurants-id-slug-contract): the path segment resolves either the
    numeric `restaurant_brand.id` (covered by
    test_unauthed_user_can_view_a_restaurant above) or the brand's `slug`.
    Factory-generated slugs are never all-digits (see factories.py
    RestaurantBrandFactory), so this exercises the slug branch of
    restaurant_service.get_restaurant.
    """
    brand = await create_brand(db_session, is_claimed=True, name="Slug Lookup House")
    await create_location(db_session, brand_id=brand.id)  # public brands need one active location
    await db_session.commit()

    response = await client.get(f"/restaurants/{brand.slug}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == brand.id
    assert body["slug"] == brand.slug
    assert body["name"] == "Slug Lookup House"


async def test_restaurant_lookup_404s_for_unknown_slug(client, as_anonymous):
    """Neither an id nor a slug match -> 404, not a 500/other error."""
    response = await client.get("/restaurants/no-such-restaurant-slug")
    assert response.status_code == 404


async def test_unauthed_user_can_view_unclaimed_listing_with_claim_cta_data(client, db_session, as_anonymous):
    """DECISIONS.md "Claim flow": unclaimed listings (owner_id NULL,
    is_claimed=false) "stay visible and searchable ... nothing is hidden
    while unclaimed." (A listing with no active location is hidden whether
    claimed or not: see test_brand_visibility.py.)
    """
    brand = await create_brand(db_session, is_claimed=False, owner_id=None)
    await create_location(db_session, brand_id=brand.id)  # public brands need one active location
    await db_session.commit()

    response = await client.get(f"/restaurants/{brand.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["is_claimed"] is False
    assert body["owner_id"] is None


async def test_unauthed_user_can_list_a_restaurants_locations(client, db_session, as_anonymous):
    brand = await create_brand(db_session, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, city="Frisco")
    await db_session.commit()

    response = await client.get(f"/restaurants/{brand.id}/locations")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["results"][0]["id"] == location.id
    assert body["results"][0]["city"] == "Frisco"


async def test_unauthed_user_can_view_a_single_location(client, db_session, as_anonymous):
    brand = await create_brand(db_session, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200
    assert response.json()["id"] == location.id


async def test_unauthed_user_can_hit_health(client, as_anonymous):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_unauthed_user_is_rejected_from_owner_only_write_route(client, db_session, as_anonymous):
    """The flip side of "public read" — no Authorization header at all on a
    route that requires one must fail closed (401), proving the
    public/private boundary is real and not just "nobody happened to check
    yet." No real JWKS call happens here either way (see
    app/dependencies/auth.py::get_current_user — missing header short-
    circuits before any token verification).
    """
    brand = await create_brand(db_session, is_claimed=True)
    await db_session.commit()

    response = await client.patch(f"/restaurants/{brand.id}", json={"description": "hijack attempt"})
    assert response.status_code == 401
