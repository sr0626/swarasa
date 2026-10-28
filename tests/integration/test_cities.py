"""Integration tests: public city endpoints for the SEO city landing pages
(`GET /cities`, `GET /cities/{slug}/restaurants`) — docs/API_CONTRACTS.md
"Cities". Covers slug normalisation/merging, state-collision suffixing, the
same visibility rules as /search (active only, no soft-deleted brands), the
content-free deal signal, pagination, 404s, and anonymous access.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.services.city_service import slugify_city
from factories import create_brand, create_deal, create_location, create_owner


async def _brand(db_session, **kwargs):
    owner = await create_owner(db_session)
    return await create_brand(db_session, owner_id=owner.id, is_claimed=True, **kwargs)


def test_slugify_city():
    assert slugify_city("Fort Worth") == "fort-worth"
    assert slugify_city("  McKinney ") == "mckinney"
    assert slugify_city("St. Paul") == "st-paul"
    assert slugify_city("San José") == "san-jose"
    assert slugify_city("!!!") == ""


@pytest.mark.asyncio
async def test_cities_lists_counts_merging_case_variants_and_hiding_non_public(client, db_session):
    b1 = await _brand(db_session, slug="b1", name="Alpha")
    b2 = await _brand(db_session, slug="b2", name="Beta")
    dead = await _brand(db_session, slug="dead", name="Dead")
    await create_location(db_session, brand_id=b1.id, slug="a", city="Irving")
    await create_location(db_session, brand_id=b2.id, slug="a", city="IRVING ", state="tx")
    await create_location(db_session, brand_id=b1.id, slug="p", city="Plano")
    await create_location(db_session, brand_id=b1.id, slug="h", city="Plano", status="owner_deactivated")
    await create_location(db_session, brand_id=b2.id, slug="c", city="Frisco", status="coming_soon")
    await create_location(db_session, brand_id=dead.id, slug="d", city="Allen")
    dead.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    response = await client.get("/cities")
    assert response.status_code == 200, response.text
    assert "public" in response.headers["cache-control"]
    body = response.json()
    assert body["total"] == 2
    got = [(c["slug"], c["location_count"], c["state"]) for c in body["results"]]
    assert got == [("irving", 2, "TX"), ("plano", 1, "TX")]


@pytest.mark.asyncio
async def test_cities_state_collision_gets_state_suffix_only_when_needed(client, db_session):
    brand = await _brand(db_session, slug="b1")
    await create_location(db_session, brand_id=brand.id, slug="a", city="Springfield", state="IL")
    await create_location(db_session, brand_id=brand.id, slug="b", city="Springfield", state="MO")
    await create_location(db_session, brand_id=brand.id, slug="c", city="Irving", state="TX")
    await db_session.commit()

    slugs = {c["slug"] for c in (await client.get("/cities")).json()["results"]}
    assert slugs == {"springfield-il", "springfield-mo", "irving"}

    body = (await client.get("/cities/springfield-mo/restaurants")).json()
    assert body["city"]["state"] == "MO"
    assert body["total"] == 1
    assert (await client.get("/cities/springfield/restaurants")).status_code == 404


@pytest.mark.asyncio
async def test_city_restaurants_lists_every_public_location_as_tiles(client, db_session):
    multi = await _brand(db_session, slug="multi", name="Multi Spice")
    solo = await _brand(db_session, slug="solo", name="Solo Dosa")
    in_irving = await create_location(
        db_session, brand_id=multi.id, slug="irving", city="Irving", address_line1="1 A St"
    )
    await create_location(db_session, brand_id=multi.id, slug="plano", city="Plano")
    await create_location(db_session, brand_id=solo.id, slug="main", city="Irving")
    await create_location(db_session, brand_id=solo.id, slug="old", city="Irving", status="owner_deactivated")
    await create_deal(db_session, location_id=in_irving.id, title="Secret lunch special")
    await db_session.commit()

    response = await client.get("/cities/irving/restaurants")
    assert response.status_code == 200, response.text
    assert "public" in response.headers["cache-control"]
    body = response.json()
    assert body["city"] == {"slug": "irving", "city": "Irving", "state": "TX", "location_count": 2}
    assert body["total"] == 2
    assert body["page"] == 1
    tiles = {r["slug"]: r for r in body["results"]}
    assert set(tiles) == {"multi", "solo"}
    multi_tile = tiles["multi"]
    assert multi_tile["nearest_location"]["slug"] == "irving"
    assert multi_tile["nearest_location"]["address_line1"] == "1 A St"
    assert multi_tile["nearest_location"]["distance_mi"] is None
    # Brand's TOTAL active locations (Irving + Plano), not just this city's.
    assert multi_tile["location_count_nearby"] == 2
    assert tiles["solo"]["location_count_nearby"] == 1
    # Public, content-free deal signal: boolean only, never the deal text.
    assert multi_tile["nearest_location"]["has_deal_today"] is True
    assert tiles["solo"]["nearest_location"]["has_deal_today"] is False
    assert "Secret lunch special" not in response.text


@pytest.mark.asyncio
async def test_city_restaurants_paginates_with_stable_order(client, db_session):
    brand = await _brand(db_session, slug="chain", name="Chain")
    for i in range(5):
        await create_location(db_session, brand_id=brand.id, slug=f"l{i}", city="Plano")
    await db_session.commit()

    seen: list[str] = []
    for page in (1, 2, 3):
        body = (await client.get(f"/cities/plano/restaurants?page={page}&page_size=2")).json()
        assert body["total"] == 5
        seen += [r["nearest_location"]["slug"] for r in body["results"]]
    assert seen == ["l0", "l1", "l2", "l3", "l4"]
    # Beyond the last page: still a known city, just an empty page.
    beyond = (await client.get("/cities/plano/restaurants?page=9&page_size=2")).json()
    assert beyond["results"] == [] and beyond["total"] == 5


@pytest.mark.asyncio
async def test_unknown_or_fully_hidden_city_is_404(client, db_session):
    brand = await _brand(db_session, slug="b1")
    await create_location(db_session, brand_id=brand.id, slug="x", city="Frisco", status="coming_soon")
    await db_session.commit()

    for slug in ("nowhere", "frisco"):
        response = await client.get(f"/cities/{slug}/restaurants")
        assert response.status_code == 404, slug
        assert response.json()["code"] == "not_found"


@pytest.mark.asyncio
async def test_cities_requires_no_auth_and_is_empty_safe(client, as_anonymous):
    response = await client.get("/cities")
    assert response.status_code == 200
    assert response.json() == {"results": [], "page": 1, "page_size": 20, "total": 0}
