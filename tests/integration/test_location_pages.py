"""Integration tests: every location has its own public page slug
(`restaurant_location.slug`, migration 0014; docs/DECISIONS.md "Location
pages") and two public by-slug lookups + a sitemap index.

Covers:
  - slug assignment on every create path (`POST /locations`, CSV bulk import),
    collision handling within a brand, independence across brands, fixed after
    an address edit, DB-level uniqueness per brand;
  - hard delete of a location and soft delete of a brand keep working;
  - `GET /restaurants/{id}/locations`, managed-locations and follow items expose `slug`;
  - `GET /restaurants/by-slug/{brand_slug}`: only ACTIVE locations, stable
    order (city, id), card fields, `has_deal_today`, 404 for unknown / soft-deleted;
  - `GET /restaurants/by-slug/{brand_slug}/locations/{location_slug}`: public
    rules (hidden -> 404 anonymous, visible to its owner; soft-deleted brand ->
    404; wrong pairing -> 404), one round trip, deal-content gating;
  - `GET /sitemap/locations`: active locations of live brands with the brand's
    active-location count.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

import app.main as app_main
from app.dependencies.auth import get_current_user_optional
from app.models.restaurant_location import RestaurantLocation
from app.schemas.restaurant_bulk_import import RestaurantBasicDetailIn
from app.services.restaurant_bulk_import_service import bulk_import_restaurants
from factories import (
    create_brand,
    create_deal,
    create_follow,
    create_location,
    create_location_manager,
    create_owner,
)


def _as_both(as_user, role, *, sub=None, email=None):
    """Public GET routes depend on `get_current_user_optional`, not the
    `get_current_user` the `as_user` fixture overrides — override both."""
    user = as_user(role, sub=sub, email=email)

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


def _create_body(brand_id: int, **overrides) -> dict:
    body = {
        "brand_id": brand_id,
        "address_line1": "2234 W Walnut Hill Ln",
        "city": "Irving",
        "state": "TX",
        "postal_code": "75038",
        "country": "US",
        "phone": "(972) 555-0142",
        "timezone": "America/Chicago",
    }
    body.update(overrides)
    return body


async def _owned_brand(db_session, **brand_kwargs):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, **brand_kwargs)
    await db_session.commit()
    return owner, brand


# ---------------------------------------------------------------------------
# Slug assignment on the create paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_location_assigns_city_slug_and_returns_brand_slug(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.post("/locations", json=_create_body(brand.id))
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["slug"] == "irving"
    assert body["brand_slug"] == brand.slug


@pytest.mark.asyncio
async def test_second_location_in_same_city_uses_city_and_street_then_numeric_suffix(
    client, db_session, as_user
):
    owner, brand = await _owned_brand(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    first = await client.post("/locations", json=_create_body(brand.id))
    second = await client.post(
        "/locations", json=_create_body(brand.id, address_line1="800 N Belt Line Rd")
    )
    third = await client.post(
        "/locations", json=_create_body(brand.id, address_line1="800 N Belt Line Rd")
    )
    assert [r.status_code for r in (first, second, third)] == [201, 201, 201]
    assert first.json()["slug"] == "irving"
    assert second.json()["slug"] == "irving-800-n-belt-line"
    assert third.json()["slug"] == "irving-800-n-belt-line-2"


@pytest.mark.asyncio
async def test_same_city_slug_is_reusable_across_brands(client, db_session, as_user):
    owner_a, brand_a = await _owned_brand(db_session)
    owner_b, brand_b = await _owned_brand(db_session)

    as_user("owner", sub=owner_a.cognito_sub, email=owner_a.email)
    a = await client.post("/locations", json=_create_body(brand_a.id))
    as_user("owner", sub=owner_b.cognito_sub, email=owner_b.email)
    b = await client.post("/locations", json=_create_body(brand_b.id))
    assert a.json()["slug"] == b.json()["slug"] == "irving"


@pytest.mark.asyncio
async def test_slug_is_fixed_when_the_address_is_edited(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    created = (await client.post("/locations", json=_create_body(brand.id))).json()

    patched = await client.patch(
        f"/locations/{created['id']}", json={"city": "Plano", "address_line1": "1 New Rd"}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["city"] == "Plano"
    assert patched.json()["slug"] == "irving"  # unchanged: shared links never break


@pytest.mark.asyncio
async def test_slug_cannot_be_set_through_the_api(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    created = (await client.post("/locations", json=_create_body(brand.id, slug="hacked"))).json()
    assert created["slug"] == "irving"
    patched = await client.patch(f"/locations/{created['id']}", json={"slug": "hacked"})
    assert patched.status_code == 200
    assert patched.json()["slug"] == "irving"


@pytest.mark.asyncio
async def test_bulk_import_assigns_slugs_with_collision_handling(db_session):
    owner = await create_owner(db_session)
    await db_session.commit()

    def _row(address: str) -> RestaurantBasicDetailIn:
        return RestaurantBasicDetailIn(
            name="Namaste Grill",
            address_line1=address,
            city="Irving",
            state="TX",
            postal_code="75038",
        )

    result = await bulk_import_restaurants(
        db_session,
        [_row("2234 W Walnut Hill Ln"), _row("800 N Belt Line Rd")],
        owner_id=owner.id,
        actor_id="admin-sub",
        actor_role="admin",
    )
    assert result.created == 2, result
    slugs = (
        (await db_session.execute(select(RestaurantLocation.slug).order_by(RestaurantLocation.id)))
        .scalars()
        .all()
    )
    assert slugs == ["irving", "irving-800-n-belt-line"]


@pytest.mark.asyncio
async def test_db_enforces_uniqueness_per_brand_but_not_across_brands(db_session):
    brand_a = await create_brand(db_session)
    brand_b = await create_brand(db_session)
    await create_location(db_session, brand_id=brand_a.id, slug="irving")
    await create_location(db_session, brand_id=brand_b.id, slug="irving")  # other brand: fine
    await db_session.commit()

    with pytest.raises(IntegrityError):
        await create_location(db_session, brand_id=brand_a.id, slug="irving")
    await db_session.rollback()


# ---------------------------------------------------------------------------
# Delete paths keep working
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hard_delete_location_works_and_frees_the_slug(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    created = (await client.post("/locations", json=_create_body(brand.id))).json()

    hide = await client.post(f"/locations/{created['id']}/status", json={"status": "owner_deactivated"})
    assert hide.status_code == 200, hide.text
    deleted = await client.delete(f"/locations/{created['id']}/permanent")
    assert deleted.status_code == 204, deleted.text

    again = await client.post("/locations", json=_create_body(brand.id))
    assert again.status_code == 201
    assert again.json()["slug"] == "irving"


@pytest.mark.asyncio
async def test_brand_soft_delete_hides_location_page_and_keeps_slugs(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session, slug="namaste-grill")
    loc = await create_location(db_session, brand_id=brand.id, slug="irving")
    await db_session.commit()

    _as_both(as_user, "admin")
    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204
    app_main.app.dependency_overrides.pop(get_current_user_optional, None)

    assert (await client.get("/restaurants/by-slug/namaste-grill")).status_code == 404
    assert (
        await client.get("/restaurants/by-slug/namaste-grill/locations/irving")
    ).status_code == 404
    stored = (
        await db_session.execute(
            select(RestaurantLocation.slug)
            .where(RestaurantLocation.id == loc.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert stored == "irving"


# ---------------------------------------------------------------------------
# Payloads expose slug
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_brand_locations_list_exposes_slug(client, db_session):
    _owner, brand = await _owned_brand(db_session)
    await create_location(db_session, brand_id=brand.id, slug="irving")
    await db_session.commit()

    response = await client.get(f"/restaurants/{brand.id}/locations")
    assert response.status_code == 200, response.text
    assert [row["slug"] for row in response.json()["results"]] == ["irving"]


@pytest.mark.asyncio
async def test_location_detail_exposes_slug_and_brand_slug(client, db_session):
    _owner, brand = await _owned_brand(db_session, slug="namaste-grill")
    loc = await create_location(db_session, brand_id=brand.id, slug="irving")
    await db_session.commit()

    body = (await client.get(f"/locations/{loc.id}")).json()
    assert body["slug"] == "irving"
    assert body["brand_slug"] == "namaste-grill"


@pytest.mark.asyncio
async def test_managed_locations_expose_slug_and_brand_slug(client, db_session, as_user):
    _owner, brand = await _owned_brand(db_session, slug="namaste-grill")
    loc = await create_location(db_session, brand_id=brand.id, slug="irving")
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=loc.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    row = (await client.get("/auth/me/managed-locations")).json()["results"][0]
    assert (row["slug"], row["brand_slug"]) == ("irving", "namaste-grill")


@pytest.mark.asyncio
async def test_follow_items_expose_the_chosen_locations_slug(client, db_session, as_user):
    sub = str(uuid.uuid4())
    brand = await create_brand(db_session)
    await db_session.flush()
    await create_follow(db_session, user_id=sub, brand_id=brand.id)
    first = await create_location(db_session, brand_id=brand.id, slug="irving")
    second = await create_location(db_session, brand_id=brand.id, slug="plano")
    await create_deal(db_session, location_id=second.id, title="Plano special")
    await db_session.commit()

    as_user("registered_user", sub=sub)
    row = (await client.get("/auth/me/follows")).json()["results"][0]
    # The deal's location wins (see follow_service._choose_location).
    assert row["nearest_location"]["location_id"] == second.id
    assert row["nearest_location"]["slug"] == "plano"
    assert first.slug == "irving"


# ---------------------------------------------------------------------------
# GET /restaurants/by-slug/{brand_slug}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_brand_by_slug_returns_only_active_locations_in_city_then_id_order(client, db_session):
    _owner, brand = await _owned_brand(db_session, slug="namaste-grill", name="Namaste Grill")
    plano = await create_location(db_session, brand_id=brand.id, slug="plano", city="Plano")
    irving_b = await create_location(db_session, brand_id=brand.id, slug="irving-b", city="Irving")
    irving_a = await create_location(db_session, brand_id=brand.id, slug="irving", city="Irving")
    await create_location(db_session, brand_id=brand.id, slug="soon", city="Aledo", status="coming_soon")
    await create_location(db_session, brand_id=brand.id, slug="off", city="Aledo", status="owner_deactivated")
    await create_location(
        db_session, brand_id=brand.id, slug="closed", city="Aledo", status="closed_pending_reopen"
    )
    await db_session.commit()

    response = await client.get("/restaurants/by-slug/namaste-grill")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "Namaste Grill"
    assert body["location_count"] == 3
    assert body["follower_count"] is None  # never public
    assert [card["slug"] for card in body["locations"]] == ["irving-b", "irving", "plano"]
    assert [card["location_id"] for card in body["locations"]] == [
        irving_b.id,
        irving_a.id,
        plano.id,
    ]


@pytest.mark.asyncio
async def test_brand_by_slug_card_fields_and_deal_signal(client, db_session):
    _owner, brand = await _owned_brand(db_session, slug="namaste-grill")
    with_deal = await create_location(
        db_session, brand_id=brand.id, slug="irving", city="Irving", address_line1="1 A St", phone="+19725550100"
    )
    without = await create_location(db_session, brand_id=brand.id, slug="plano", city="Plano")
    await create_deal(db_session, location_id=with_deal.id, title="Secret lunch special")
    await db_session.commit()

    body = (await client.get("/restaurants/by-slug/namaste-grill")).json()
    cards = {c["slug"]: c for c in body["locations"]}
    assert cards["irving"]["has_deal_today"] is True
    assert cards["plano"]["has_deal_today"] is False
    assert cards["irving"]["address_line1"] == "1 A St"
    assert cards["irving"]["phone"] == "+19725550100"
    assert cards["irving"]["distance_mi"] is None
    for key in ("is_open_now", "open_time", "close_time", "is_closed", "cover_photo_url", "is_paid"):
        assert key in cards["irving"]
    # Public and content-free: the deal's title never appears on this payload.
    assert "Secret lunch special" not in (await client.get("/restaurants/by-slug/namaste-grill")).text
    assert without.slug == "plano"


@pytest.mark.asyncio
async def test_brand_by_slug_with_no_active_location_returns_empty_list(client, db_session):
    _owner, brand = await _owned_brand(db_session, slug="namaste-grill")
    await create_location(db_session, brand_id=brand.id, slug="irving", status="coming_soon")
    await db_session.commit()

    response = await client.get("/restaurants/by-slug/namaste-grill")
    assert response.status_code == 200
    assert response.json()["locations"] == []
    assert response.json()["location_count"] == 0


@pytest.mark.asyncio
async def test_brand_by_slug_404_for_unknown_and_soft_deleted(client, db_session):
    from datetime import datetime, timezone

    _owner, brand = await _owned_brand(db_session, slug="gone-grill")
    await create_location(db_session, brand_id=brand.id, slug="irving")
    brand.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    assert (await client.get("/restaurants/by-slug/gone-grill")).status_code == 404
    assert (await client.get("/restaurants/by-slug/no-such-brand")).status_code == 404


@pytest.mark.asyncio
async def test_by_slug_route_is_not_swallowed_by_generic_routes(client, db_session):
    # A brand whose slug is literally "locations" (the word in the sibling
    # `/{brand_id}/locations` route) still resolves through by-slug.
    _owner, brand = await _owned_brand(db_session, slug="locations")
    await create_location(db_session, brand_id=brand.id, slug="irving")
    await db_session.commit()
    response = await client.get("/restaurants/by-slug/locations")
    assert response.status_code == 200, response.text
    assert response.json()["slug"] == "locations"


@pytest.mark.asyncio
async def test_brand_by_slug_is_batched_not_n_plus_one(client, db_session):
    from sqlalchemy import event

    _owner, brand = await _owned_brand(db_session, slug="big-chain")
    for i in range(12):
        await create_location(db_session, brand_id=brand.id, slug=f"c{i}", city=f"City {i}")
    await db_session.commit()

    statements: list[str] = []
    sync_engine = db_session.bind.sync_engine

    def _count(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    event.listen(sync_engine, "before_cursor_execute", _count)
    try:
        response = await client.get("/restaurants/by-slug/big-chain")
    finally:
        event.remove(sync_engine, "before_cursor_execute", _count)
    assert response.status_code == 200
    assert len(response.json()["locations"]) == 12
    # Constant, independent of the 12 locations (brand, tags, counts, then one
    # query each for locations / hours / covers / deals).
    assert len(statements) <= 12, statements


# ---------------------------------------------------------------------------
# GET /restaurants/by-slug/{brand_slug}/locations/{location_slug}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_location_page_returns_brand_and_location_in_one_call(client, db_session):
    _owner, brand = await _owned_brand(db_session, slug="namaste-grill", name="Namaste Grill")
    loc = await create_location(
        db_session, brand_id=brand.id, slug="irving", city="Irving", address_line1="1 A St"
    )
    await create_location(db_session, brand_id=brand.id, slug="plano", city="Plano")
    await db_session.commit()

    response = await client.get("/restaurants/by-slug/namaste-grill/locations/irving")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["restaurant"]["slug"] == "namaste-grill"
    assert body["restaurant"]["location_count"] == 2  # ACTIVE count -> canonical decision
    assert body["location"]["id"] == loc.id
    assert body["location"]["slug"] == "irving"
    assert body["location"]["address_line1"] == "1 A St"
    for key in ("hours", "gallery_photos", "has_deal_today", "deals_today", "upcoming_deals"):
        assert key in body["location"]


@pytest.mark.asyncio
async def test_location_page_matches_get_location_by_id(client, db_session):
    _owner, brand = await _owned_brand(db_session, slug="namaste-grill")
    loc = await create_location(db_session, brand_id=brand.id, slug="irving")
    await db_session.commit()

    by_slug = (await client.get("/restaurants/by-slug/namaste-grill/locations/irving")).json()
    by_id = (await client.get(f"/locations/{loc.id}")).json()
    assert by_slug["location"] == by_id


@pytest.mark.asyncio
async def test_location_page_404_for_unknown_and_wrong_brand_pairing(client, db_session):
    _owner_a, brand_a = await _owned_brand(db_session, slug="brand-a")
    _owner_b, brand_b = await _owned_brand(db_session, slug="brand-b")
    await create_location(db_session, brand_id=brand_a.id, slug="irving")
    await create_location(db_session, brand_id=brand_b.id, slug="plano")
    await db_session.commit()

    assert (await client.get("/restaurants/by-slug/brand-a/locations/nope")).status_code == 404
    assert (await client.get("/restaurants/by-slug/nope/locations/irving")).status_code == 404
    # brand-b's slug under brand-a's URL must not resolve.
    assert (await client.get("/restaurants/by-slug/brand-a/locations/plano")).status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["owner_deactivated", "coming_soon", "closed_pending_reopen"])
async def test_hidden_location_page_404s_for_the_public_but_not_its_owner(
    client, db_session, as_user, status
):
    owner, brand = await _owned_brand(db_session, slug="namaste-grill")
    await create_location(db_session, brand_id=brand.id, slug="irving", status=status)
    await db_session.commit()
    url = "/restaurants/by-slug/namaste-grill/locations/irving"

    assert (await client.get(url)).status_code == 404

    _as_both(as_user, "registered_user")
    assert (await client.get(url)).status_code == 404

    _as_both(as_user, "owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get(url)
    assert response.status_code == 200, response.text
    assert response.json()["location"]["status"] == status


@pytest.mark.asyncio
async def test_location_page_deal_content_signed_out_null_signed_in_content(client, db_session, as_user):
    _owner, brand = await _owned_brand(db_session, slug="namaste-grill")
    loc = await create_location(db_session, brand_id=brand.id, slug="irving")
    await create_deal(db_session, location_id=loc.id, title="Members only lunch")
    await db_session.commit()
    url = "/restaurants/by-slug/namaste-grill/locations/irving"

    anon = (await client.get(url)).json()["location"]
    assert anon["has_deal_today"] is True
    assert anon["deals_today"] is None
    assert "Members only lunch" not in (await client.get(url)).text

    _as_both(as_user, "registered_user")
    member = (await client.get(url)).json()["location"]
    assert [d["title"] for d in member["deals_today"]] == ["Members only lunch"]

    # 2026-09-25: an owner of ANOTHER brand is signed in too -> content, not null.
    _as_both(as_user, "owner")
    other = (await client.get(url)).json()["location"]
    assert [d["title"] for d in other["deals_today"]] == ["Members only lunch"]
    assert other["upcoming_deals"] == []


# ---------------------------------------------------------------------------
# GET /sitemap/locations
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sitemap_index_lists_active_locations_of_live_brands_with_counts(client, db_session):
    from datetime import datetime, timezone

    _o1, single = await _owned_brand(db_session, slug="single-brand")
    await create_location(db_session, brand_id=single.id, slug="irving")
    _o2, multi = await _owned_brand(db_session, slug="multi-brand")
    await create_location(db_session, brand_id=multi.id, slug="irving")
    await create_location(db_session, brand_id=multi.id, slug="plano")
    await create_location(db_session, brand_id=multi.id, slug="hidden", status="owner_deactivated")
    _o3, dead = await _owned_brand(db_session, slug="dead-brand")
    await create_location(db_session, brand_id=dead.id, slug="irving")
    dead.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    response = await client.get("/sitemap/locations")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 3
    rows = {(r["brand_slug"], r["location_slug"]): r["active_location_count"] for r in body["results"]}
    assert rows == {
        ("single-brand", "irving"): 1,
        ("multi-brand", "irving"): 2,
        ("multi-brand", "plano"): 2,
    }


@pytest.mark.asyncio
async def test_sitemap_index_count_is_right_when_a_brand_straddles_pages(client, db_session):
    _o, brand = await _owned_brand(db_session, slug="multi-brand")
    for i in range(3):
        await create_location(db_session, brand_id=brand.id, slug=f"c{i}")
    await db_session.commit()

    page2 = (await client.get("/sitemap/locations?page=2&page_size=2")).json()
    assert page2["total"] == 3
    assert [r["active_location_count"] for r in page2["results"]] == [3]
